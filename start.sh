#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd -- "$script_dir"

provider_url="${LLAMACPP_BASE_URL:-${LLM_BASE_URL:-http://127.0.0.1:8080/v1}}"
model="${LLAMACPP_MODEL:-${LLM_MODEL:-margin-local}}"
formula_ocr_url="${FORMULA_OCR_BASE_URL:-}"
formula_ocr_url_requested=false
start_formula_ocr=false

formula_ocr_image="margin-formula-ocr:pix2tex-0.1.4"
formula_ocr_container="margin-formula-ocr"
formula_ocr_managed_label="io.margin.managed=formula-ocr"
formula_ocr_config_label="io.margin.formula-ocr.config=1"
formula_ocr_service_dir="$script_dir/services/formula-ocr"
formula_ocr_port="${FORMULA_OCR_PORT:-8502}"
formula_ocr_threads="${FORMULA_OCR_THREADS:-4}"
formula_ocr_start_timeout="${FORMULA_OCR_START_TIMEOUT_SECONDS:-240}"
formula_ocr_env_file=""

cleanup_formula_ocr_env_file() {
  if [[ -n "$formula_ocr_env_file" && -f "$formula_ocr_env_file" ]]; then
    rm -f -- "$formula_ocr_env_file"
  fi
  formula_ocr_env_file=""
}

trap cleanup_formula_ocr_env_file EXIT

is_integer_in_range() {
  local value="$1"
  local minimum="$2"
  local maximum="$3"
  [[ "$value" =~ ^[0-9]+$ ]] &&
    ((10#$value >= minimum && 10#$value <= maximum))
}

start_local_formula_ocr() {
  local formula_ocr_base_url="http://127.0.0.1:${formula_ocr_port}"
  local managed_label=""
  local existing_config_label=""
  local existing_image_id=""
  local desired_image_id=""
  local existing_host_ip=""
  local existing_port=""
  local existing_running=""
  local existing_threads=""
  local existing_mkl_threads=""
  local existing_api_key=""
  local container_environment=""
  local container_exists=false
  local recreate_container=false
  local readiness_deadline=0
  local docker_context=""
  local docker_host="${DOCKER_HOST:-}"
  local docker_endpoint=""
  local -a docker_command=()

  if ! command -v docker >/dev/null 2>&1; then
    echo "Docker is required by --start-formula-ocr but was not found." >&2
    exit 1
  fi
  if ! command -v curl >/dev/null 2>&1; then
    echo "curl is required to check Formula OCR readiness." >&2
    exit 1
  fi

  if [[ -n "${DOCKER_CONTEXT:-}" ]]; then
    docker_context="$DOCKER_CONTEXT"
  elif [[ -z "$docker_host" ]]; then
    if ! docker_context="$(docker context show 2>/dev/null)"; then
      echo "Could not determine the active Docker context." >&2
      exit 1
    fi
  fi

  if [[ -n "$docker_context" ]]; then
    if ! docker_endpoint="$(
      docker context inspect \
        --format '{{(index .Endpoints "docker").Host}}' \
        "$docker_context" 2>/dev/null
    )"; then
      echo "Could not inspect Docker context '$docker_context'." >&2
      exit 1
    fi
  else
    docker_endpoint="$docker_host"
  fi

  if [[ "$docker_endpoint" != unix://* ]]; then
    echo "--start-formula-ocr requires a Docker daemon on this machine." >&2
    echo "Use --formula-ocr-url for an OCR service on another system." >&2
    exit 1
  fi

  docker_command=(docker --host "$docker_endpoint")
  if ! "${docker_command[@]}" info >/dev/null 2>&1; then
    if ! command -v sudo >/dev/null 2>&1; then
      echo "This account cannot access Docker and sudo is unavailable." >&2
      exit 1
    fi
    echo "Docker daemon access requires sudo; you may be prompted for your password."
    if ! sudo -v; then
      echo "Could not obtain permission to access the Docker daemon." >&2
      exit 1
    fi
    docker_command=(sudo docker --host "$docker_endpoint")
    if ! "${docker_command[@]}" info >/dev/null 2>&1; then
      echo "Could not connect to the Docker daemon, even with sudo." >&2
      exit 1
    fi
  fi

  echo "Building the local Formula OCR image (the first build can take several minutes)…"
  "${docker_command[@]}" build \
    --tag "$formula_ocr_image" \
    "$formula_ocr_service_dir"
  desired_image_id="$(
    "${docker_command[@]}" image inspect \
      --format '{{.Id}}' \
      "$formula_ocr_image"
  )"

  if "${docker_command[@]}" container inspect \
    "$formula_ocr_container" >/dev/null 2>&1; then
    container_exists=true
    managed_label="$(
      "${docker_command[@]}" container inspect \
        --format '{{index .Config.Labels "io.margin.managed"}}' \
        "$formula_ocr_container"
    )"
    if [[ "$managed_label" != "formula-ocr" ]]; then
      echo "A container named '$formula_ocr_container' already exists but is not managed by Margin." >&2
      echo "Rename or remove that container, then retry." >&2
      exit 1
    fi
    existing_config_label="$(
      "${docker_command[@]}" container inspect \
        --format '{{index .Config.Labels "io.margin.formula-ocr.config"}}' \
        "$formula_ocr_container"
    )"

    existing_image_id="$(
      "${docker_command[@]}" container inspect \
        --format '{{.Image}}' \
        "$formula_ocr_container"
    )"
    existing_port="$(
      "${docker_command[@]}" container inspect \
        --format '{{with index .HostConfig.PortBindings "8502/tcp"}}{{with index . 0}}{{.HostPort}}{{end}}{{end}}' \
        "$formula_ocr_container"
    )"
    existing_host_ip="$(
      "${docker_command[@]}" container inspect \
        --format '{{with index .HostConfig.PortBindings "8502/tcp"}}{{with index . 0}}{{.HostIp}}{{end}}{{end}}' \
        "$formula_ocr_container"
    )"
    existing_running="$(
      "${docker_command[@]}" container inspect \
        --format '{{.State.Running}}' \
        "$formula_ocr_container"
    )"
    container_environment="$(
      "${docker_command[@]}" container inspect \
        --format '{{range .Config.Env}}{{println .}}{{end}}' \
        "$formula_ocr_container"
    )"
    while IFS= read -r environment_entry; do
      case "$environment_entry" in
        OMP_NUM_THREADS=*)
          existing_threads="${environment_entry#*=}"
          ;;
        MKL_NUM_THREADS=*)
          existing_mkl_threads="${environment_entry#*=}"
          ;;
        FORMULA_OCR_API_KEY=*)
          existing_api_key="${environment_entry#*=}"
          ;;
      esac
    done <<< "$container_environment"

    if [[ "$existing_config_label" != "1" ||
          "$existing_image_id" != "$desired_image_id" ||
          "$existing_port" != "$formula_ocr_port" ||
          "$existing_host_ip" != "127.0.0.1" ||
          "$existing_threads" != "$formula_ocr_threads" ||
          "$existing_mkl_threads" != "$formula_ocr_threads" ||
          "$existing_api_key" != "${FORMULA_OCR_API_KEY:-}" ]]; then
      recreate_container=true
    fi
  fi

  if [[ "$recreate_container" == true ]]; then
    echo "Updating the managed Formula OCR container…"
    "${docker_command[@]}" container rm --force "$formula_ocr_container"
    container_exists=false
  fi

  if [[ "$container_exists" == true ]]; then
    if [[ "$existing_running" == "true" ]]; then
      echo "Formula OCR container is already running."
    else
      echo "Starting the existing Formula OCR container…"
      if ! "${docker_command[@]}" container start \
        "$formula_ocr_container" >/dev/null; then
        echo "Formula OCR could not start. Check whether port ${formula_ocr_port} is already in use." >&2
        exit 1
      fi
    fi
  else
    formula_ocr_env_file="$(
      mktemp "${TMPDIR:-/tmp}/margin-formula-ocr.XXXXXX.env"
    )"
    chmod 600 "$formula_ocr_env_file"
    {
      printf 'OMP_NUM_THREADS=%s\n' "$formula_ocr_threads"
      printf 'MKL_NUM_THREADS=%s\n' "$formula_ocr_threads"
      if [[ -n "${FORMULA_OCR_API_KEY:-}" ]]; then
        printf 'FORMULA_OCR_API_KEY=%s\n' "$FORMULA_OCR_API_KEY"
      fi
    } > "$formula_ocr_env_file"

    echo "Starting the Formula OCR container on 127.0.0.1:${formula_ocr_port}…"
    if ! "${docker_command[@]}" run \
      --detach \
      --name "$formula_ocr_container" \
      --label "$formula_ocr_managed_label" \
      --label "$formula_ocr_config_label" \
      --restart unless-stopped \
      --read-only \
      --cap-drop ALL \
      --security-opt no-new-privileges \
      --tmpfs /tmp:size=128m,mode=1777 \
      --publish "127.0.0.1:${formula_ocr_port}:8502" \
      --env-file "$formula_ocr_env_file" \
      "$formula_ocr_image" >/dev/null; then
      cleanup_formula_ocr_env_file
      if [[ "$(
        "${docker_command[@]}" container inspect \
          --format '{{index .Config.Labels "io.margin.managed"}}' \
          "$formula_ocr_container" 2>/dev/null || true
      )" == "formula-ocr" ]]; then
        "${docker_command[@]}" container rm --force \
          "$formula_ocr_container" >/dev/null 2>&1 || true
      fi
      echo "Formula OCR could not start. Check whether port ${formula_ocr_port} is already in use." >&2
      exit 1
    fi
    cleanup_formula_ocr_env_file
  fi

  echo "Waiting for the Formula OCR model to become ready…"
  readiness_deadline=$((SECONDS + formula_ocr_start_timeout))
  until curl --fail --silent --show-error --max-time 2 \
    "$formula_ocr_base_url/health" >/dev/null 2>&1; do
    if [[ "$(
      "${docker_command[@]}" container inspect \
        --format '{{.State.Running}}' \
        "$formula_ocr_container" 2>/dev/null || true
    )" != "true" ]]; then
      echo "Formula OCR stopped before becoming ready. Recent container output:" >&2
      "${docker_command[@]}" container logs --tail 20 \
        "$formula_ocr_container" >&2 || true
      exit 1
    fi
    if ((SECONDS >= readiness_deadline)); then
      echo "Formula OCR did not become ready within ${formula_ocr_start_timeout} seconds." >&2
      "${docker_command[@]}" container logs --tail 20 \
        "$formula_ocr_container" >&2 || true
      exit 1
    fi
    sleep 2
  done

  echo "Formula OCR is ready."
  formula_ocr_url="$formula_ocr_base_url"
}

usage() {
  cat <<'EOF'
Usage: ./start.sh [--provider-url URL] [--model NAME]
                  [--start-formula-ocr | --formula-ocr-url URL]

Start Margin in development mode with a separately managed llama.cpp provider
and an optional formula OCR companion.

Options:
  --provider-url URL      Provider API root (default: http://127.0.0.1:8080/v1)
  --model NAME            Provider model or llama-server alias (default: margin-local)
  --start-formula-ocr     Build and start the bundled local Docker companion
  --formula-ocr-url URL   Use an already-running formula OCR API
  -h, --help              Show this help

Set LLM_API_KEY in the environment if the provider requires authentication.
Set FORMULA_OCR_API_KEY when the formula OCR service requires a bearer token.
FORMULA_OCR_PORT, FORMULA_OCR_THREADS, and
FORMULA_OCR_START_TIMEOUT_SECONDS customize local Docker startup.
EOF
}

while (($# > 0)); do
  case "$1" in
    --provider-url)
      if (($# < 2)); then
        echo "Missing value for --provider-url." >&2
        exit 2
      fi
      provider_url="$2"
      shift 2
      ;;
    --provider-url=*)
      provider_url="${1#*=}"
      shift
      ;;
    --model)
      if (($# < 2)); then
        echo "Missing value for --model." >&2
        exit 2
      fi
      model="$2"
      shift 2
      ;;
    --model=*)
      model="${1#*=}"
      shift
      ;;
    --formula-ocr-url)
      if (($# < 2)); then
        echo "Missing value for --formula-ocr-url." >&2
        exit 2
      fi
      formula_ocr_url="$2"
      formula_ocr_url_requested=true
      shift 2
      ;;
    --formula-ocr-url=*)
      formula_ocr_url="${1#*=}"
      formula_ocr_url_requested=true
      shift
      ;;
    --start-formula-ocr)
      start_formula_ocr=true
      shift
      ;;
    -h | --help)
      usage
      exit
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ -z "${provider_url//[[:space:]]/}" ]]; then
  echo "Provider URL cannot be empty." >&2
  exit 2
fi

if [[ -z "${model//[[:space:]]/}" ]]; then
  echo "Model cannot be empty." >&2
  exit 2
fi

if [[ "$formula_ocr_url_requested" == true &&
      -z "${formula_ocr_url//[[:space:]]/}" ]]; then
  echo "Formula OCR URL cannot be empty." >&2
  exit 2
fi

if [[ "$start_formula_ocr" != true &&
      -n "$formula_ocr_url" &&
      -z "${formula_ocr_url//[[:space:]]/}" ]]; then
  echo "FORMULA_OCR_BASE_URL cannot contain only whitespace." >&2
  exit 2
fi

if [[ "$start_formula_ocr" == true &&
      "$formula_ocr_url_requested" == true ]]; then
  echo "--start-formula-ocr cannot be combined with --formula-ocr-url." >&2
  exit 2
fi

if [[ "$start_formula_ocr" == true ]]; then
  if ! is_integer_in_range "$formula_ocr_port" 1 65535; then
    echo "FORMULA_OCR_PORT must be an integer from 1 to 65535." >&2
    exit 2
  fi
  if ! is_integer_in_range "$formula_ocr_threads" 1 64; then
    echo "FORMULA_OCR_THREADS must be an integer from 1 to 64." >&2
    exit 2
  fi
  if ! is_integer_in_range "$formula_ocr_start_timeout" 1 600; then
    echo "FORMULA_OCR_START_TIMEOUT_SECONDS must be an integer from 1 to 600." >&2
    exit 2
  fi
  formula_ocr_port=$((10#$formula_ocr_port))
  formula_ocr_threads=$((10#$formula_ocr_threads))
  formula_ocr_start_timeout=$((10#$formula_ocr_start_timeout))
  if [[ "${FORMULA_OCR_API_KEY:-}" == *$'\n'* ||
        "${FORMULA_OCR_API_KEY:-}" == *$'\r'* ]]; then
    echo "FORMULA_OCR_API_KEY cannot contain a newline." >&2
    exit 2
  fi
  start_local_formula_ocr
fi

if [[ ! -f node_modules/.package-lock.json ||
      package.json -nt node_modules/.package-lock.json ||
      package-lock.json -nt node_modules/.package-lock.json ]] ||
  ! npm ls --depth=0 --silent >/dev/null 2>&1; then
  npm ci
fi

export LLM_PROVIDER=llamacpp
export LLAMACPP_BASE_URL="$provider_url"
export LLAMACPP_MODEL="$model"

if [[ -n "$formula_ocr_url" ]]; then
  export FORMULA_OCR_BASE_URL="$formula_ocr_url"
fi

exec npm run dev
