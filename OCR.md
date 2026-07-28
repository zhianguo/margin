# Formula OCR

Margin can optionally transcribe a selected formula image into LaTeX before
requesting an explanation. This is best-effort formula recognition for a
bounded selection; it is not full-page OCR for scanned or image-only PDFs.

## Quick start

The one-line launcher path requires Docker and a separately running llama.cpp
provider. From the Margin project directory, start Margin and the bundled
Formula OCR companion with:

```bash
./start.sh --provider-url http://127.0.0.1:8080/v1 --start-formula-ocr
```

Replace the provider URL when llama.cpp runs on another system. The launcher
builds the OCR image, starts or reuses a hardened container named
`margin-formula-ocr`, waits for its model to load, and configures Margin to use
it.

Formula OCR itself is provider-independent. When Margin uses OpenAI, Gemini, or
another compatible provider, start the companion manually, set
`FORMULA_OCR_BASE_URL`, and start Margin with `npm run dev`.

The first build can take several minutes because it downloads and verifies the
pix2tex checkpoints and CPU PyTorch wheels. It also needs a few gigabytes of
temporary disk space. The weights are baked into the resulting image, so normal
container startup does not download them again.

The launcher uses ordinary Docker commands. It may ask for your sudo password
when your account cannot access the Docker daemon. Do not run the whole launcher
with `sudo`, because that can create root-owned Node files in the repository.

## How recognition works

The browser sends a selected formula crop through the Margin application server
to the configured OCR companion:

```text
selected formula crop
        │
        ▼
POST /api/formula/recognize
        │
        ▼
Formula OCR companion
        │
        ▼
recognized LaTeX
```

The full PDF and full-page image remain in the browser. Only the bounded formula
crop is sent to OCR. See [Privacy](PRIVACY.md) for the authoritative data-flow
and browser-storage description.

The bundled service uses Python 3.10 and `pix2tex==0.1.4`, listens on port 8502,
and serializes inference to limit CPU memory pressure. Formula snapshots and
manual correction continue to work when the service is unavailable.

Compact mathematical diagrams bypass formula OCR. Margin displays the saved
PDF-page crop directly and uses approximate geometry-derived layout text as a
fallback, preserving bars, arrows, and two-dimensional layout that can be
missing from an older PDF's text layer. The approximate layout text is never
treated as verified notation.

## Use an existing OCR service

To use an OCR companion that is already running:

```bash
./start.sh \
  --provider-url http://127.0.0.1:8080/v1 \
  --formula-ocr-url http://127.0.0.1:8502
```

The OCR service can run on the same machine as Margin or on another
HTTP-accessible system.

## Configuration

The launcher, Margin server, and Compose file use these environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `FORMULA_OCR_BASE_URL` | unset | URL of an already-running OCR service |
| `FORMULA_OCR_API_KEY` | unset | Optional shared bearer token |
| `FORMULA_OCR_TIMEOUT_MS` | `30000` | Recognition timeout, clamped to 1,000–120,000 ms |
| `FORMULA_OCR_PORT` | `8502` | Host port for the launcher-managed container |
| `FORMULA_OCR_THREADS` | `4` | OCR container CPU thread count |
| `FORMULA_OCR_START_TIMEOUT_SECONDS` | `240` | Launcher readiness timeout |
| `FORMULA_OCR_BIND` | `127.0.0.1` | Host interface used by Docker Compose |

For example, allow more time on a slower CPU:

```bash
export FORMULA_OCR_TIMEOUT_MS=60000
./start.sh --provider-url http://127.0.0.1:8080/v1 --start-formula-ocr
```

Bearer authentication is optional. Set the same secret for Margin and the OCR
service:

```bash
export FORMULA_OCR_API_KEY=replace-with-a-long-random-secret
./start.sh --provider-url http://127.0.0.1:8080/v1 --start-formula-ocr
```

`GET /health` remains public for container health checks. Recognition requests
to `POST /v1/recognize` require the bearer token when one is configured.

## Manage the container manually

The recommended launcher path does not require Docker Compose. If you prefer
manual container management, start the companion with:

```bash
docker compose -f services/formula-ocr/compose.yaml up --build --detach
curl http://127.0.0.1:8502/health
```

Then use the `--formula-ocr-url` launcher option described above.

If `docker compose version` reports that Compose is unavailable on Ubuntu,
install it with `sudo apt install docker-compose-v2`; Docker's upstream package
repository may call the package `docker-compose-plugin`. Prefix only Docker
commands with `sudo` when socket access is denied.

The equivalent Docker commands are:

```bash
docker build \
  --tag margin-formula-ocr:pix2tex-0.1.4 \
  services/formula-ocr
docker run --rm \
  --read-only \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --tmpfs /tmp:size=128m,mode=1777 \
  --publish 127.0.0.1:8502:8502 \
  margin-formula-ocr:pix2tex-0.1.4
```

The supplied dependency lock targets Linux x86_64. ARM64 hosts need a separately
resolved and tested dependency lock.

## Remote access and security

The Compose service binds to loopback by default. To run OCR on another system,
set `FORMULA_OCR_BIND=0.0.0.0`, restrict port 8502 with that system's firewall,
and pass the reachable URL to Margin. Plain HTTP exposes the selected formula
crop in transit, so use HTTPS outside a trusted network.

For a public hosted deployment, enforce a global rate limit at the edge or in
front of the OCR service. The bundled worker limit is a per-process burst guard;
private deployment access or an upstream global limit prevents a public proxy
from consuming the CPU inference slot continuously. See [Security](SECURITY.md)
for the general deployment policy.

## HTTP API

The recognition endpoint accepts a raw PNG, WebP, or JPEG body of at most 2 MiB:

```bash
curl \
  --header "Authorization: Bearer ${FORMULA_OCR_API_KEY}" \
  --header "Content-Type: image/png" \
  --data-binary @formula.png \
  http://127.0.0.1:8502/v1/recognize
```

The response contains a delimiter-free LaTeX body:

```json
{"latex":"L(s,\\sigma)=\\prod_p\\cdots"}
```

Recognition is best effort. Compare the result with the saved page crop and
correct it in Margin before relying on the explanation.

## Stop or restart OCR

Stop and remove the Compose-managed container with:

```bash
docker compose -f services/formula-ocr/compose.yaml down
```

Stop a launcher-managed container with:

```bash
docker container stop margin-formula-ocr
```

The launcher reuses the managed container the next time
`--start-formula-ocr` is passed. It recreates the container when its image or
relevant configuration changes.

## Architecture and validation

The companion implementation lives under:

```text
services/formula-ocr/
├── formula_ocr/api.py         validated, serialized pix2tex HTTP API
├── Dockerfile                 Python 3.10 CPU image with prefetched weights
└── compose.yaml               loopback-bound optional companion
```

Run its lightweight API suite with a mocked inference model:

```bash
uv run \
  --isolated \
  --with-requirements services/formula-ocr/requirements-test.txt \
  python -m pytest -q services/formula-ocr/tests
```

## Boundaries

- Recognition is best effort and should be checked against the selected image.
- CPU inference can take several seconds.
- Formula OCR does not make text selectable in image-only or scanned PDFs;
  those documents need full-page OCR before Margin can select their text.
- Compact diagrams are rendered from their selected image crop rather than
  passed through pix2tex.
