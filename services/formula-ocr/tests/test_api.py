from __future__ import annotations

import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

SERVICE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE_ROOT))

from formula_ocr.api import (
    MAX_IMAGE_BYTES,
    MAX_IMAGE_PIXELS,
    MAX_LATEX_CHARACTERS,
    FormulaBusyError,
    SerializedRecognizer,
    create_app,
    normalize_latex,
)


class FakeModel:
    def __init__(self, prediction: str = r"$$ \frac{x}{y} $$"):
        self.prediction = prediction
        self.images: list[Image.Image] = []

    def __call__(self, image: Image.Image) -> str:
        self.images.append(image.copy())
        return self.prediction


def image_bytes(image_format: str = "PNG", size: tuple[int, int] = (96, 28)) -> bytes:
    output = BytesIO()
    Image.new("RGB", size, "white").save(output, format=image_format)
    return output.getvalue()


def client_for(
    model: FakeModel | None = None, api_key: str = ""
) -> tuple[TestClient, FakeModel]:
    selected_model = model or FakeModel()
    application = create_app(
        model_factory=lambda: selected_model,
        api_key=api_key,
    )
    return TestClient(application), selected_model


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        (r"$$ \frac{x}{y} $$", r"\frac{x}{y}"),
        (r"\[x^2 + y^2\]", "x^2 + y^2"),
        ("```latex\nx_1\n```", "x_1"),
        (r"\begin{equation*} x = 1 \end{equation*}", "x = 1"),
    ],
)
def test_normalizes_outer_latex_delimiters(raw: str, expected: str) -> None:
    assert normalize_latex(raw) == expected


def test_health_and_raw_png_recognition() -> None:
    test_client, model = client_for()

    with test_client:
        health = test_client.get("/health")
        response = test_client.post(
            "/v1/recognize",
            content=image_bytes(),
            headers={"Content-Type": "image/png"},
        )

    assert health.json() == {
        "ok": True,
        "service": "formula-ocr",
        "model": "pix2tex-0.1.4",
    }
    assert response.status_code == 200
    assert response.json() == {"latex": r"\frac{x}{y}"}
    assert model.images[0].mode == "RGB"
    assert model.images[0].size == (96, 28)


@pytest.mark.parametrize(
    ("image_format", "content_type"),
    [("JPEG", "image/jpeg"), ("WEBP", "image/webp")],
)
def test_accepts_other_supported_raw_image_formats(
    image_format: str, content_type: str
) -> None:
    test_client, _model = client_for(FakeModel("x = 1"))

    with test_client:
        response = test_client.post(
            "/v1/recognize",
            content=image_bytes(image_format),
            headers={"Content-Type": content_type},
        )

    assert response.status_code == 200
    assert response.json() == {"latex": "x = 1"}


def test_optional_bearer_auth_protects_recognition_but_not_health() -> None:
    test_client, _model = client_for(api_key="correct-secret")
    body = image_bytes()

    with test_client:
        assert test_client.get("/health").status_code == 200
        missing = test_client.post(
            "/v1/recognize",
            content=body,
            headers={"Content-Type": "image/png"},
        )
        wrong = test_client.post(
            "/v1/recognize",
            content=body,
            headers={
                "Content-Type": "image/png",
                "Authorization": "Bearer wrong-secret",
            },
        )
        accepted = test_client.post(
            "/v1/recognize",
            content=body,
            headers={
                "Content-Type": "image/png",
                "Authorization": "Bearer correct-secret",
            },
        )

    assert missing.status_code == 401
    assert missing.headers["www-authenticate"] == "Bearer"
    assert wrong.status_code == 401
    assert accepted.status_code == 200


@pytest.mark.parametrize(
    ("body", "content_type", "status"),
    [
        (b"", "image/png", 400),
        (b"not an image", "image/png", 415),
        (image_bytes("PNG"), "text/plain", 415),
        (image_bytes("PNG"), "image/jpeg", 415),
        (image_bytes("JPEG"), "image/png", 415),
    ],
)
def test_rejects_bad_image_inputs(body: bytes, content_type: str, status: int) -> None:
    test_client, _model = client_for()

    with test_client:
        response = test_client.post(
            "/v1/recognize",
            content=body,
            headers={"Content-Type": content_type},
        )

    assert response.status_code == status


def test_rejects_oversized_body_and_dimensions() -> None:
    test_client, _model = client_for()

    with test_client:
        oversized_body = test_client.post(
            "/v1/recognize",
            content=b"x" * (MAX_IMAGE_BYTES + 1),
            headers={"Content-Type": "image/png"},
        )
        oversized_dimensions = test_client.post(
            "/v1/recognize",
            content=image_bytes(size=(4_097, 1)),
            headers={"Content-Type": "image/png"},
        )
        oversized_pixels = test_client.post(
            "/v1/recognize",
            content=image_bytes(size=(2_048, MAX_IMAGE_PIXELS // 2_048 + 1)),
            headers={"Content-Type": "image/png"},
        )

    assert oversized_body.status_code == 413
    assert oversized_dimensions.status_code == 422
    assert oversized_pixels.status_code == 422


def test_empty_model_result_is_a_gateway_error() -> None:
    test_client, _model = client_for(FakeModel("$$  $$"))

    with test_client:
        response = test_client.post(
            "/v1/recognize",
            content=image_bytes(),
            headers={"Content-Type": "image/png"},
        )

    assert response.status_code == 502
    assert response.json() == {
        "detail": "Formula recognition returned no usable result."
    }


def test_rejects_model_result_over_contract_limit() -> None:
    test_client, _model = client_for(FakeModel("x" * (MAX_LATEX_CHARACTERS + 1)))

    with test_client:
        response = test_client.post(
            "/v1/recognize",
            content=image_bytes(),
            headers={"Content-Type": "image/png"},
        )

    assert response.status_code == 502
    assert response.json() == {
        "detail": "Formula recognition returned no usable result."
    }


def test_rejects_concurrent_cpu_inference_instead_of_queueing() -> None:
    entered = threading.Event()
    release = threading.Event()

    class SlowModel:
        def __call__(self, _image: Image.Image) -> str:
            entered.set()
            release.wait(timeout=1)
            return "x"

    recognizer = SerializedRecognizer(SlowModel())
    image = Image.new("RGB", (8, 8), "white")

    with ThreadPoolExecutor(max_workers=4) as executor:
        running = executor.submit(recognizer.recognize, image)
        assert entered.wait(timeout=1)
        rejected = [
            executor.submit(recognizer.recognize, image) for _index in range(3)
        ]
        for request in rejected:
            with pytest.raises(FormulaBusyError):
                request.result(timeout=1)
        release.set()

    assert running.result(timeout=1) == "x"


def test_busy_api_response_has_retry_guidance() -> None:
    entered = threading.Event()
    release = threading.Event()

    class SlowModel(FakeModel):
        def __call__(self, _image: Image.Image) -> str:
            entered.set()
            release.wait(timeout=1)
            return "x"

    test_client, _model = client_for(SlowModel())
    image = Image.new("RGB", (8, 8), "white")

    with test_client:
        recognizer = test_client.app.state.recognizer
        with ThreadPoolExecutor(max_workers=1) as executor:
            running = executor.submit(recognizer.recognize, image)
            assert entered.wait(timeout=1)
            response = test_client.post(
                "/v1/recognize",
                content=image_bytes(),
                headers={"Content-Type": "image/png"},
            )
            release.set()

    assert running.result(timeout=1) == "x"
    assert response.status_code == 503
    assert response.headers["Retry-After"] == "1"
    assert response.json() == {
        "detail": "Formula recognition is busy. Retry shortly."
    }


def test_releases_pix2tex_interactive_image_state() -> None:
    class RetainingModel:
        last_pic: Image.Image | None = None

        def __call__(self, image: Image.Image) -> str:
            self.last_pic = image
            return "x"

    model = RetainingModel()
    recognizer = SerializedRecognizer(model)

    assert recognizer.recognize(Image.new("RGB", (8, 8), "white")) == "x"
    assert model.last_pic is None
