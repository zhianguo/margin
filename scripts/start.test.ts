// @vitest-environment node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const projectRoot = resolve(import.meta.dirname, "..");
const searxngSettingsHash = createHash("sha256")
  .update(
    readFileSync(join(projectRoot, "services", "searxng", "settings.yml"))
  )
  .digest("hex");
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

async function executable(
  directory: string,
  name: string,
  source: string
): Promise<void> {
  const path = join(directory, name);
  await writeFile(path, source);
  await chmod(path, 0o755);
}

async function createFakeCommands(): Promise<{
  binDirectory: string;
  logPath: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), "margin-start-test-"));
  temporaryDirectories.push(directory);
  const binDirectory = join(directory, "bin");
  const logPath = join(directory, "commands.log");
  await mkdir(binDirectory);

  await executable(
    binDirectory,
    "docker",
    `#!/usr/bin/env bash
if [[ "$1" == "context" && "$2" == "show" ]]; then
  printf 'docker|%s\\n' "$*" >> "$LAUNCH_TEST_LOG"
  echo "\${DOCKER_CONTEXT:-default}"
  exit 0
fi

if [[ "$1" == "context" && "$2" == "inspect" ]]; then
  printf 'docker|%s\\n' "$*" >> "$LAUNCH_TEST_LOG"
  echo "\${LAUNCH_TEST_CONTEXT_ENDPOINT:-unix:///var/run/docker.sock}"
  exit "\${LAUNCH_TEST_CONTEXT_INSPECT_STATUS:-0}"
fi

if [[ "$1" == "--host" ]]; then
  shift 2
fi

printf 'docker|%s\\n' "$*" >> "$LAUNCH_TEST_LOG"

if [[ "$1" == "info" ]]; then
  if [[ "\${LAUNCH_TEST_AS_SUDO:-}" == "1" ]]; then
    exit 0
  fi
  exit "\${LAUNCH_TEST_DOCKER_INFO_STATUS:-0}"
fi

if [[ "$1" == "build" ]]; then
  exit "\${LAUNCH_TEST_BUILD_STATUS:-0}"
fi

if [[ "$1" == "image" && "$2" == "inspect" ]]; then
  image_name="\${!#}"
  if [[ "$image_name" == *searxng* ]]; then
    if [[ "$3" != "--format" ]]; then
      exit "\${LAUNCH_TEST_SEARXNG_IMAGE_STATUS:-0}"
    fi
    echo "sha256:searxng-image"
  else
    echo "sha256:formula-image"
  fi
  exit 0
fi

if [[ "$1" == "image" && "$2" == "pull" ]]; then
  exit "\${LAUNCH_TEST_SEARXNG_PULL_STATUS:-0}"
fi

if [[ "$1" == "container" && "$2" == "inspect" ]]; then
  container_name="\${!#}"
  if [[ "$3" != "--format" ]]; then
    if [[ "$container_name" == "margin-searxng" ]]; then
      exit "\${LAUNCH_TEST_SEARXNG_CONTAINER_EXISTS_STATUS:-1}"
    fi
    exit "\${LAUNCH_TEST_CONTAINER_EXISTS_STATUS:-1}"
  fi
  case "$4" in
    *io.margin.managed*)
      if [[ "$container_name" == "margin-searxng" ]]; then
        echo "\${LAUNCH_TEST_SEARXNG_MANAGED_LABEL:-searxng}"
      else
        echo "\${LAUNCH_TEST_MANAGED_LABEL:-formula-ocr}"
      fi
      ;;
    *io.margin.formula-ocr.config*)
      echo "1"
      ;;
    *io.margin.searxng.config*)
      echo "\${LAUNCH_TEST_SEARXNG_CONFIG_LABEL:-1}"
      ;;
    *io.margin.searxng.settings-sha256*)
      echo "$LAUNCH_TEST_SEARXNG_SETTINGS_HASH"
      ;;
    *'.Image'*)
      if [[ "$container_name" == "margin-searxng" ]]; then
        echo "sha256:searxng-image"
      else
        echo "sha256:formula-image"
      fi
      ;;
    *PortBindings*)
      if [[ "$4" == *'.HostIp'* ]]; then
        if [[ "$container_name" == "margin-searxng" ]]; then
          echo "\${LAUNCH_TEST_SEARXNG_HOST_IP:-127.0.0.1}"
        else
          echo "\${LAUNCH_TEST_HOST_IP:-127.0.0.1}"
        fi
      elif [[ "$container_name" == "margin-searxng" ]]; then
        echo "\${SEARXNG_PORT:-8888}"
      else
        echo "\${FORMULA_OCR_PORT:-8502}"
      fi
      ;;
    *State.Running*)
      if [[ "$container_name" == "margin-searxng" ]]; then
        echo "\${LAUNCH_TEST_SEARXNG_CONTAINER_RUNNING:-true}"
      else
        echo "\${LAUNCH_TEST_CONTAINER_RUNNING:-true}"
      fi
      ;;
    *Config.Env*)
      printf 'OMP_NUM_THREADS=%s\\n' "\${FORMULA_OCR_THREADS:-4}"
      printf 'MKL_NUM_THREADS=%s\\n' "\${FORMULA_OCR_THREADS:-4}"
      if [[ -n "\${FORMULA_OCR_API_KEY:-}" ]]; then
        printf 'FORMULA_OCR_API_KEY=%s\\n' "$FORMULA_OCR_API_KEY"
      fi
      ;;
  esac
  exit 0
fi

if [[ "$1" == "run" ]]; then
  service="formula-ocr"
  for argument in "$@"; do
    if [[ "$argument" == "margin-searxng" ]]; then
      service="searxng"
    fi
  done
  previous=""
  for argument in "$@"; do
    if [[ "$previous" == "--env-file" ]]; then
      if grep -q '^FORMULA_OCR_API_KEY=' "$argument"; then
        echo "docker-env-file|api-key-present" >> "$LAUNCH_TEST_LOG"
      fi
      if grep -q '^SEARXNG_SECRET=' "$argument"; then
        echo "docker-env-file|searxng-secret-present" >> "$LAUNCH_TEST_LOG"
      fi
    fi
    previous="$argument"
  done
  if [[ "$service" == "searxng" ]]; then
    exit "\${LAUNCH_TEST_SEARXNG_RUN_STATUS:-0}"
  fi
  exit "\${LAUNCH_TEST_RUN_STATUS:-0}"
fi

if [[ "$1" == "container" && "$2" == "start" ]]; then
  if [[ "$3" == "margin-searxng" ]]; then
    exit "\${LAUNCH_TEST_SEARXNG_START_STATUS:-0}"
  fi
  exit "\${LAUNCH_TEST_START_STATUS:-0}"
fi

if [[ "$1" == "container" && "$2" == "rm" ]]; then
  exit 0
fi

if [[ "$1" == "container" && "$2" == "logs" ]]; then
  exit 0
fi

exit 97
`
  );

  await executable(
    binDirectory,
    "npm",
    `#!/usr/bin/env bash
if [[ "$1" == "ls" ]]; then
  exit 0
fi
printf 'npm|%s|provider=%s|model=%s|formula=%s|search=%s|searxng=%s\\n' \
  "$*" \
  "\${LLAMACPP_BASE_URL:-}" \
  "\${LLAMACPP_MODEL:-}" \
  "\${FORMULA_OCR_BASE_URL:-}" \
  "\${WEB_SEARCH_PROVIDER:-}" \
  "\${SEARXNG_BASE_URL:-}" >> "$LAUNCH_TEST_LOG"
exit 0
`
  );

  await executable(
    binDirectory,
    "curl",
    `#!/usr/bin/env bash
printf 'curl|%s\\n' "$*" >> "$LAUNCH_TEST_LOG"
if [[ "$*" == *"format=json"* ]]; then
  if [[ "\${LAUNCH_TEST_CURL_INVALID_JSON:-}" == "1" ]]; then
    printf '<html>not json</html>\\n'
  else
    printf '{"results":[]}\\n'
  fi
fi
exit "\${LAUNCH_TEST_CURL_STATUS:-0}"
`
  );

  await executable(
    binDirectory,
    "sudo",
    `#!/usr/bin/env bash
printf 'sudo|%s\\n' "$*" >> "$LAUNCH_TEST_LOG"
if [[ "$1" == "-v" ]]; then
  exit "\${LAUNCH_TEST_SUDO_STATUS:-0}"
fi
LAUNCH_TEST_AS_SUDO=1 exec "$@"
`
  );

  return { binDirectory, logPath };
}

async function runLauncher(
  arguments_: string[],
  environment: Record<string, string> = {}
): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
  log: string;
}> {
  const { binDirectory, logPath } = await createFakeCommands();
  const inheritedEnvironment = { ...process.env };
  for (const key of Object.keys(inheritedEnvironment)) {
    if (
      key === "DOCKER_HOST" ||
      key === "DOCKER_CONTEXT" ||
      key.startsWith("FORMULA_OCR_") ||
      key.startsWith("LAUNCH_TEST_") ||
      key.startsWith("LLAMACPP_") ||
      key.startsWith("LLM_") ||
      key.startsWith("SEARXNG_") ||
      key.startsWith("WEB_SEARCH_")
    ) {
      delete inheritedEnvironment[key];
    }
  }
  const child = spawn("/bin/bash", [join(projectRoot, "start.sh"), ...arguments_], {
    cwd: projectRoot,
    env: {
      ...inheritedEnvironment,
      PATH: `${binDirectory}:${process.env.PATH ?? ""}`,
      LAUNCH_TEST_LOG: logPath,
      LAUNCH_TEST_SEARXNG_SETTINGS_HASH: searxngSettingsHash,
      ...environment
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const code = await new Promise<number | null>((resolvePromise, reject) => {
    child.once("error", reject);
    child.once("exit", resolvePromise);
  });
  const log = await readFile(logPath, "utf8").catch(() => "");
  return { code, stdout, stderr, log };
}

describe("start.sh Formula OCR Docker startup", () => {
  it("keeps separately managed Formula OCR startup unchanged", async () => {
    const result = await runLauncher([
      "--provider-url",
      "http://llama-host:8080/v1",
      "--model",
      "reader-model",
      "--formula-ocr-url",
      "http://ocr-host:8502"
    ]);

    expect(result.code).toBe(0);
    expect(result.log).not.toContain("docker|");
    expect(result.log).toContain(
      "npm|run dev|provider=http://llama-host:8080/v1|model=reader-model|formula=http://ocr-host:8502"
    );
  });

  it("builds, hardens, starts, and configures the local companion", async () => {
    const result = await runLauncher(
      [
        "--provider-url",
        "http://llama-host:8080/v1",
        "--start-formula-ocr"
      ],
      {
        FORMULA_OCR_PORT: "8600",
        FORMULA_OCR_THREADS: "2",
        FORMULA_OCR_API_KEY: "test-secret"
      }
    );

    expect(result.code).toBe(0);
    expect(result.log).toContain(
      `docker|build --tag margin-formula-ocr:pix2tex-0.1.4 ${projectRoot}/services/formula-ocr`
    );
    expect(result.log).toContain("docker|run --detach --name margin-formula-ocr");
    expect(result.log).toContain("--read-only --cap-drop ALL");
    expect(result.log).toContain("--publish 127.0.0.1:8600:8502");
    expect(result.log).toContain("docker-env-file|api-key-present");
    expect(result.log).not.toContain("test-secret");
    expect(result.stdout).not.toContain("test-secret");
    expect(result.stderr).not.toContain("test-secret");
    const envFile = result.log.match(/--env-file ([^ ]+)/)?.[1];
    expect(envFile).toBeDefined();
    await expect(access(envFile as string)).rejects.toThrow();
    expect(result.log).toContain(
      "npm|run dev|provider=http://llama-host:8080/v1|model=margin-local|formula=http://127.0.0.1:8600"
    );
    expect(result.log.indexOf("docker|build ")).toBeLessThan(
      result.log.indexOf("docker|run ")
    );
    expect(result.log.indexOf("docker|run ")).toBeLessThan(
      result.log.indexOf("curl|")
    );
    expect(result.log.indexOf("curl|")).toBeLessThan(
      result.log.indexOf("npm|run dev")
    );
  });

  it("normalizes leading-zero numeric settings before arithmetic and Docker use", async () => {
    const result = await runLauncher(["--start-formula-ocr"], {
      FORMULA_OCR_PORT: "08502",
      FORMULA_OCR_THREADS: "04",
      FORMULA_OCR_START_TIMEOUT_SECONDS: "008"
    });

    expect(result.code).toBe(0);
    expect(result.log).toContain("--publish 127.0.0.1:8502:8502");
    expect(result.log).toContain("npm|run dev");
  });

  it("reuses an up-to-date managed container", async () => {
    const result = await runLauncher(["--start-formula-ocr"], {
      LAUNCH_TEST_CONTAINER_EXISTS_STATUS: "0"
    });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("already running");
    expect(result.log).not.toContain("docker|run ");
    expect(result.log).not.toContain("docker|container rm");
    expect(result.log).toContain("npm|run dev");
  });

  it("starts a stopped but otherwise current managed container", async () => {
    const result = await runLauncher(["--start-formula-ocr"], {
      LAUNCH_TEST_CONTAINER_EXISTS_STATUS: "0",
      LAUNCH_TEST_CONTAINER_RUNNING: "false"
    });

    expect(result.code).toBe(0);
    expect(result.log).toContain("docker|container start margin-formula-ocr");
    expect(result.log).not.toContain("docker|run ");
    expect(result.log).toContain("npm|run dev");
  });

  it("recreates a managed container that is not bound to loopback", async () => {
    const result = await runLauncher(["--start-formula-ocr"], {
      LAUNCH_TEST_CONTAINER_EXISTS_STATUS: "0",
      LAUNCH_TEST_HOST_IP: "0.0.0.0"
    });

    expect(result.code).toBe(0);
    expect(result.log).toContain(
      "docker|container rm --force margin-formula-ocr"
    );
    expect(result.log).toContain("docker|run --detach");
  });

  it("uses sudo for Docker only when direct daemon access is denied", async () => {
    const result = await runLauncher(["--start-formula-ocr"], {
      LAUNCH_TEST_DOCKER_INFO_STATUS: "1"
    });

    expect(result.code).toBe(0);
    expect(result.log).toContain("sudo|-v");
    expect(result.log).toContain(
      "sudo|docker --host unix:///var/run/docker.sock info"
    );
    expect(result.log).toContain(
      "sudo|docker --host unix:///var/run/docker.sock build"
    );
    expect(result.log).toContain("npm|run dev");
  });

  it("rejects a remote Docker context instead of returning a false local URL", async () => {
    const result = await runLauncher(["--start-formula-ocr"], {
      DOCKER_CONTEXT: "remote",
      LAUNCH_TEST_CONTEXT_ENDPOINT: "ssh://docker-host"
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("requires a Docker daemon on this machine");
    expect(result.log).not.toContain("docker|info");
    expect(result.log).not.toContain("docker|build");
    expect(result.log).not.toContain("npm|run dev");
  });

  it("propagates an image build failure without starting Margin", async () => {
    const result = await runLauncher(["--start-formula-ocr"], {
      LAUNCH_TEST_BUILD_STATUS: "37"
    });

    expect(result.code).toBe(37);
    expect(result.log).not.toContain("docker|run ");
    expect(result.log).not.toContain("npm|run dev");
  });

  it("refuses to replace an unrelated container with the managed name", async () => {
    const result = await runLauncher(["--start-formula-ocr"], {
      LAUNCH_TEST_CONTAINER_EXISTS_STATUS: "0",
      LAUNCH_TEST_MANAGED_LABEL: "another-service"
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("is not managed by Margin");
    expect(result.log).not.toContain("docker|container rm");
    expect(result.log).not.toContain("npm|run dev");
  });

  it("rejects conflicting OCR startup choices before invoking Docker", async () => {
    const result = await runLauncher([
      "--start-formula-ocr",
      "--formula-ocr-url",
      "http://127.0.0.1:8502"
    ]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("cannot be combined");
    expect(result.log).not.toContain("docker|");
    expect(result.log).not.toContain("npm|run dev");
  });
});

describe("start.sh SearXNG Docker startup", () => {
  it("leaves existing search configuration and Docker untouched without the option", async () => {
    const result = await runLauncher([], {
      WEB_SEARCH_PROVIDER: "tavily"
    });

    expect(result.code).toBe(0);
    expect(result.log).not.toContain("docker|");
    expect(result.log).toContain("|search=tavily|searxng=");
  });

  it("pulls, hardens, starts, validates, and configures local search", async () => {
    const result = await runLauncher(["--start-searxng"], {
      LAUNCH_TEST_SEARXNG_IMAGE_STATUS: "1",
      SEARXNG_PORT: "8899"
    });

    expect(result.code).toBe(0);
    expect(result.log).toContain(
      "docker|image pull docker.io/searxng/searxng:2026.7.31-057a77168"
    );
    expect(result.log).toContain("docker|run --detach --name margin-searxng");
    expect(result.log).toContain("--user 977:977 --read-only --cap-drop ALL");
    expect(result.log).toContain("--security-opt no-new-privileges");
    expect(result.log).toContain("--publish 127.0.0.1:8899:8080");
    expect(result.log).toContain(
      "--mount type=bind,source=" +
        projectRoot +
        "/services/searxng/settings.yml,target=/etc/searxng/settings.yml,readonly"
    );
    expect(result.log).toContain(
      "--mount type=volume,source=margin-searxng-data,target=/var/cache/searxng"
    );
    expect(result.log).toContain("docker-env-file|searxng-secret-present");
    expect(result.log).toContain(
      "--label io.margin.searxng.settings-sha256=" + searxngSettingsHash
    );
    expect(result.log).not.toContain("SEARXNG_SECRET=");
    const envFile = result.log.match(/--env-file ([^ ]+)/)?.[1];
    expect(envFile).toBeDefined();
    await expect(access(envFile as string)).rejects.toThrow();
    expect(result.log).toContain(
      "curl|--fail --silent --show-error --max-time 2 http://127.0.0.1:8899/healthz"
    );
    expect(result.log).toContain("--data-urlencode format=json");
    expect(result.log).toContain(
      "npm|run dev|provider=http://127.0.0.1:8080/v1|model=margin-local|formula=|search=searxng|searxng=http://127.0.0.1:8899"
    );
  });

  it("reuses an up-to-date running managed container", async () => {
    const result = await runLauncher(["--start-searxng"], {
      LAUNCH_TEST_SEARXNG_CONTAINER_EXISTS_STATUS: "0"
    });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("SearXNG container is already running");
    expect(result.log).not.toContain("docker|run ");
    expect(result.log).not.toContain("docker|container rm");
    expect(result.log).toContain(
      "|search=searxng|searxng=http://127.0.0.1:8888"
    );
  });

  it("starts a stopped but otherwise current managed container", async () => {
    const result = await runLauncher(["--start-searxng"], {
      LAUNCH_TEST_SEARXNG_CONTAINER_EXISTS_STATUS: "0",
      LAUNCH_TEST_SEARXNG_CONTAINER_RUNNING: "false"
    });

    expect(result.code).toBe(0);
    expect(result.log).toContain("docker|container start margin-searxng");
    expect(result.log).not.toContain("docker|run ");
  });

  it("recreates a managed container that is not bound to loopback", async () => {
    const result = await runLauncher(["--start-searxng"], {
      LAUNCH_TEST_SEARXNG_CONTAINER_EXISTS_STATUS: "0",
      LAUNCH_TEST_SEARXNG_HOST_IP: "0.0.0.0"
    });

    expect(result.code).toBe(0);
    expect(result.log).toContain(
      "docker|container rm --force --volumes margin-searxng"
    );
    expect(result.log).toContain("docker|run --detach --name margin-searxng");
  });

  it("recreates a managed container when its settings have changed", async () => {
    const result = await runLauncher(["--start-searxng"], {
      LAUNCH_TEST_SEARXNG_CONTAINER_EXISTS_STATUS: "0",
      LAUNCH_TEST_SEARXNG_SETTINGS_HASH: "stale-settings"
    });

    expect(result.code).toBe(0);
    expect(result.log).toContain(
      "docker|container rm --force --volumes margin-searxng"
    );
    expect(result.log).toContain(
      "--label io.margin.searxng.settings-sha256=" + searxngSettingsHash
    );
  });

  it("refuses to replace an unrelated container with the managed name", async () => {
    const result = await runLauncher(["--start-searxng"], {
      LAUNCH_TEST_SEARXNG_CONTAINER_EXISTS_STATUS: "0",
      LAUNCH_TEST_SEARXNG_MANAGED_LABEL: "another-service"
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("is not managed by Margin");
    expect(result.log).not.toContain("docker|container rm");
    expect(result.log).not.toContain("npm|run dev");
  });

  it("rejects invalid local settings before invoking Docker", async () => {
    const invalidPort = await runLauncher(["--start-searxng"], {
      SEARXNG_PORT: "70000"
    });
    const invalidTimeout = await runLauncher(["--start-searxng"], {
      SEARXNG_START_TIMEOUT_SECONDS: "0"
    });

    expect(invalidPort.code).toBe(2);
    expect(invalidPort.stderr).toContain("SEARXNG_PORT");
    expect(invalidPort.log).not.toContain("docker|");
    expect(invalidTimeout.code).toBe(2);
    expect(invalidTimeout.stderr).toContain("SEARXNG_START_TIMEOUT_SECONDS");
    expect(invalidTimeout.log).not.toContain("docker|");
  });

  it("rejects a successful response that is not SearXNG JSON", async () => {
    const result = await runLauncher(["--start-searxng"], {
      LAUNCH_TEST_CURL_INVALID_JSON: "1"
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("JSON search API is unavailable");
    expect(result.log).not.toContain("npm|run dev");
  });

  it("starts search and Formula OCR together before Margin", async () => {
    const result = await runLauncher([
      "--provider-url",
      "http://llama-host:8080/v1",
      "--start-searxng",
      "--start-formula-ocr"
    ]);

    expect(result.code).toBe(0);
    expect(result.log).toContain("docker|run --detach --name margin-searxng");
    expect(result.log).toContain(
      "docker|run --detach --name margin-formula-ocr"
    );
    expect(result.log).toContain(
      "npm|run dev|provider=http://llama-host:8080/v1|model=margin-local|formula=http://127.0.0.1:8502|search=searxng|searxng=http://127.0.0.1:8888"
    );
    expect(result.log.lastIndexOf("curl|")).toBeLessThan(
      result.log.indexOf("npm|run dev")
    );
  });

  it("ships a configuration with the JSON search response enabled", async () => {
    const settings = await readFile(
      join(projectRoot, "services", "searxng", "settings.yml"),
      "utf8"
    );

    expect(settings).toMatch(/formats:\s*\n\s*- html\s*\n\s*- json/);
    expect(settings).toContain("public_instance: false");
  });
});
