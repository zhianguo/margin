FROM python:3.10-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    CUDA_VISIBLE_DEVICES="" \
    HOME=/tmp/formula-ocr-home \
    XDG_CACHE_HOME=/tmp/formula-ocr-cache \
    MPLCONFIGDIR=/tmp/formula-ocr-matplotlib \
    NO_ALBUMENTATIONS_UPDATE=1 \
    OMP_NUM_THREADS=4 \
    MKL_NUM_THREADS=4

WORKDIR /opt/formula-ocr

RUN apt-get update \
    && apt-get install --yes --no-install-recommends libglib2.0-0 libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.lock.txt ./
RUN python -m pip install --no-cache-dir --upgrade pip==25.0.1 \
    && python -m pip install \
        --no-cache-dir \
        --require-hashes \
        --extra-index-url https://download.pytorch.org/whl/cpu \
        --requirement requirements.lock.txt

# pix2tex 0.1.4 downloads these fixed v0.0.1 checkpoints. Prefetch them so
# production startup is network-independent, then verify the upstream assets.
RUN python -m pix2tex.model.checkpoints.get_latest_checkpoint \
    && checkpoint_dir="$(python -c 'import pathlib, pix2tex; print(pathlib.Path(pix2tex.__file__).parent / "model" / "checkpoints")')" \
    && echo "a63d9141c53d266cb682fb5a8bd83bd5cbe283145e0e78ebdc0f895195a1dfaa  ${checkpoint_dir}/weights.pth" | sha256sum --check --strict - \
    && echo "1c3820659985ad142b526490bb25c23d977176ac2073591b3bddada692718458  ${checkpoint_dir}/image_resizer.pth" | sha256sum --check --strict -

COPY formula_ocr ./formula_ocr

RUN useradd --no-create-home --uid 10001 formula-ocr \
    && chmod -R a+rX /usr/local/lib/python3.10/site-packages/pix2tex \
    && chmod -R a-w /opt/formula-ocr

USER formula-ocr

EXPOSE 8502

HEALTHCHECK --interval=30s --timeout=5s --start-period=180s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8502/health', timeout=3)"]

CMD ["uvicorn", "formula_ocr.api:app", "--host", "0.0.0.0", "--port", "8502", "--workers", "1", "--no-access-log"]
