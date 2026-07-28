from __future__ import annotations

import logging
import os
import re
import secrets
import threading
import warnings
from collections.abc import Callable
from contextlib import asynccontextmanager
from io import BytesIO
from typing import Protocol

from fastapi import FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import BaseModel

LOGGER = logging.getLogger("formula-ocr")

PIX2TEX_VERSION = "0.1.4"
MAX_IMAGE_BYTES = 2 * 1024 * 1024
MAX_IMAGE_WIDTH = 4_096
MAX_IMAGE_HEIGHT = 2_048
MAX_IMAGE_PIXELS = 2_097_152
MAX_LATEX_CHARACTERS = 4_096

SUPPORTED_MEDIA_TYPES = {
    "image/jpeg": "jpeg",
    "image/jpg": "jpeg",
    "image/png": "png",
    "image/webp": "webp",
}

_CODE_FENCE = re.compile(
    r"\A```(?:latex|tex|math|katex)?[ \t]*\n?([\s\S]*?)\n?```\Z",
    re.IGNORECASE,
)
_EQUATION_ENVIRONMENT = re.compile(
    r"\A\\begin\{(equation\*?|displaymath)\}\s*([\s\S]*?)\s*"
    r"\\end\{\1\}\Z",
    re.IGNORECASE,
)


class FormulaModel(Protocol):
    def __call__(self, image: Image.Image) -> str: ...


class RecognitionResponse(BaseModel):
    latex: str


class FormulaInferenceError(RuntimeError):
    """Raised when the OCR model does not produce usable LaTeX."""


class FormulaBusyError(RuntimeError):
    """Raised when the single CPU inference slot is already occupied."""


def load_pix2tex_model() -> FormulaModel:
    # Keep the heavyweight dependency lazy so API validation tests do not load
    # torch or model weights.
    from pix2tex.cli import LatexOCR

    root_logger = logging.getLogger()
    previous_level = root_logger.level
    try:
        return LatexOCR()
    finally:
        # pix2tex 0.1.4 changes the process-wide logger level while loading.
        root_logger.setLevel(previous_level)


def normalize_latex(value: str) -> str:
    """Return a delimiter-free formula body suitable for KaTeX."""
    normalized = value.replace("\r\n", "\n").strip()
    fence = _CODE_FENCE.fullmatch(normalized)
    if fence:
        normalized = fence.group(1).strip()

    changed = True
    while changed and normalized:
        changed = False
        environment = _EQUATION_ENVIRONMENT.fullmatch(normalized)
        if environment:
            normalized = environment.group(2).strip()
            changed = True
            continue

        for opening, closing in (
            ("$$", "$$"),
            (r"\[", r"\]"),
            (r"\(", r"\)"),
            ("$", "$"),
        ):
            if (
                len(normalized) >= len(opening) + len(closing)
                and normalized.startswith(opening)
                and normalized.endswith(closing)
            ):
                normalized = normalized[len(opening) : -len(closing)].strip()
                changed = True
                break

    return normalized


class SerializedRecognizer:
    """Run one CPU inference at a time to bound memory and latency variance."""

    def __init__(self, model: FormulaModel):
        self._model = model
        self._lock = threading.Lock()

    def recognize(self, image: Image.Image) -> str:
        if not self._lock.acquire(blocking=False):
            raise FormulaBusyError("formula inference is already running")
        try:
            prediction = self._model(image)
        finally:
            # LatexOCR retains its latest input for its interactive CLI. The
            # API does not need that state, so release the crop promptly.
            if hasattr(self._model, "last_pic"):
                self._model.last_pic = None
            self._lock.release()

        if not isinstance(prediction, str):
            raise FormulaInferenceError("pix2tex returned a non-text prediction")

        latex = normalize_latex(prediction)
        if not latex:
            raise FormulaInferenceError("pix2tex returned an empty prediction")
        if len(latex) > MAX_LATEX_CHARACTERS:
            raise FormulaInferenceError("pix2tex returned an oversized prediction")
        return latex


def _detect_image_format(data: bytes) -> str | None:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data.startswith(b"\xff\xd8\xff"):
        return "jpeg"
    if len(data) >= 12 and data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return "webp"
    return None


async def _read_bounded_body(request: Request) -> bytes:
    content_length = request.headers.get("content-length")
    if content_length is not None:
        try:
            declared_length = int(content_length)
        except ValueError as error:
            raise HTTPException(
                status_code=400, detail="Content-Length must be an integer."
            ) from error
        if declared_length < 0:
            raise HTTPException(
                status_code=400, detail="Content-Length cannot be negative."
            )
        if declared_length > MAX_IMAGE_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"Image exceeds the {MAX_IMAGE_BYTES}-byte limit.",
            )

    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > MAX_IMAGE_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"Image exceeds the {MAX_IMAGE_BYTES}-byte limit.",
            )

    if not body:
        raise HTTPException(status_code=400, detail="Image body cannot be empty.")
    return bytes(body)


def _decode_image(data: bytes, media_type: str) -> Image.Image:
    detected_format = _detect_image_format(data)
    expected_format = SUPPORTED_MEDIA_TYPES[media_type]
    if detected_format is None:
        raise HTTPException(
            status_code=415,
            detail="Body is not a supported PNG, WebP, or JPEG image.",
        )
    if detected_format != expected_format:
        raise HTTPException(
            status_code=415,
            detail="Content-Type does not match the image bytes.",
        )

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(data)) as candidate:
                if getattr(candidate, "n_frames", 1) != 1:
                    raise HTTPException(
                        status_code=422,
                        detail="Animated or multi-frame images are not supported.",
                    )
                width, height = candidate.size
                if (
                    width < 1
                    or height < 1
                    or width > MAX_IMAGE_WIDTH
                    or height > MAX_IMAGE_HEIGHT
                    or width * height > MAX_IMAGE_PIXELS
                ):
                    raise HTTPException(
                        status_code=422,
                        detail=(
                            "Image dimensions exceed the "
                            f"{MAX_IMAGE_WIDTH}x{MAX_IMAGE_HEIGHT} / "
                            f"{MAX_IMAGE_PIXELS}-pixel limit."
                        ),
                    )
                candidate.verify()

            with Image.open(BytesIO(data)) as decoded:
                decoded.load()
                return ImageOps.exif_transpose(decoded).convert("RGB")
    except HTTPException:
        raise
    except (
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
        UnidentifiedImageError,
        OSError,
        ValueError,
    ) as error:
        raise HTTPException(
            status_code=422, detail="Image could not be decoded safely."
        ) from error


def _authorize(request: Request, api_key: str) -> None:
    if not api_key:
        return

    scheme, separator, credential = request.headers.get("authorization", "").partition(
        " "
    )
    if (
        not separator
        or scheme.lower() != "bearer"
        or not secrets.compare_digest(credential.strip(), api_key)
    ):
        raise HTTPException(
            status_code=401,
            detail="A valid bearer token is required.",
            headers={"WWW-Authenticate": "Bearer"},
        )


def create_app(
    *,
    model_factory: Callable[[], FormulaModel] = load_pix2tex_model,
    api_key: str | None = None,
) -> FastAPI:
    configured_api_key = (
        os.environ.get("FORMULA_OCR_API_KEY", "") if api_key is None else api_key
    ).strip()

    @asynccontextmanager
    async def lifespan(application: FastAPI):
        LOGGER.info("Loading pix2tex %s on CPU", PIX2TEX_VERSION)
        model = await run_in_threadpool(model_factory)
        application.state.recognizer = SerializedRecognizer(model)
        LOGGER.info("Formula OCR is ready")
        yield

    application = FastAPI(
        title="Margin Formula OCR",
        version=PIX2TEX_VERSION,
        docs_url=None,
        redoc_url=None,
        lifespan=lifespan,
    )

    @application.get("/health")
    async def health() -> dict[str, str | bool]:
        return {
            "ok": True,
            "service": "formula-ocr",
            "model": f"pix2tex-{PIX2TEX_VERSION}",
        }

    @application.post(
        "/v1/recognize",
        response_model=RecognitionResponse,
        responses={
            400: {"description": "Empty or malformed request"},
            401: {"description": "Invalid bearer token"},
            413: {"description": "Image is too large"},
            415: {"description": "Unsupported or mismatched image format"},
            422: {"description": "Unsafe or invalid image dimensions"},
            502: {"description": "Inference failed"},
            503: {"description": "Inference slot is busy"},
        },
    )
    async def recognize(request: Request) -> RecognitionResponse:
        _authorize(request, configured_api_key)

        media_type = (
            request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
        )
        if media_type not in SUPPORTED_MEDIA_TYPES:
            raise HTTPException(
                status_code=415,
                detail="Content-Type must be image/png, image/webp, or image/jpeg.",
            )

        data = await _read_bounded_body(request)
        image = _decode_image(data, media_type)
        try:
            latex = await run_in_threadpool(
                application.state.recognizer.recognize, image
            )
        except FormulaBusyError as error:
            raise HTTPException(
                status_code=503,
                detail="Formula recognition is busy. Retry shortly.",
                headers={"Retry-After": "1"},
            ) from error
        except FormulaInferenceError as error:
            LOGGER.warning("Formula OCR returned no usable result: %s", error)
            raise HTTPException(
                status_code=502, detail="Formula recognition returned no usable result."
            ) from error
        except Exception as error:
            LOGGER.exception("Formula OCR inference failed")
            raise HTTPException(
                status_code=502, detail="Formula recognition failed."
            ) from error

        return RecognitionResponse(latex=latex)

    @application.exception_handler(HTTPException)
    async def http_exception_handler(
        _request: Request, error: HTTPException
    ) -> JSONResponse:
        return JSONResponse(
            status_code=error.status_code,
            content={"detail": error.detail},
            headers=error.headers,
        )

    return application


app = create_app()
