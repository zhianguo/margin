import { z } from "zod";

export interface FormulaOcrEnvironment {
  FORMULA_OCR_BASE_URL?: string;
  FORMULA_OCR_API_KEY?: string;
  FORMULA_OCR_TIMEOUT_MS?: string;
}

export interface FormulaProviderConfig {
  label: string;
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  configured: boolean;
  configurationError?: string;
}

export interface FormulaRecognition {
  latex: string;
  model?: string;
}

export interface FormulaRecognitionStatus {
  configured: boolean;
  reachable: boolean | null;
  label: string;
  model?: string;
  configurationError?: string;
}

export const MAX_FORMULA_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_FORMULA_RESPONSE_BYTES = 32 * 1024;
const FORMULA_HEALTH_TIMEOUT_MS = 2_500;
const DEFAULT_FORMULA_TIMEOUT_MS = 30_000;
const MIN_FORMULA_TIMEOUT_MS = 1_000;
const MAX_FORMULA_TIMEOUT_MS = 120_000;

const FormulaRecognitionSchema = z
  .object({
    latex: z.string().trim().min(1).max(4_096),
    model: z.string().trim().min(1).max(200).optional()
  })
  .strict();

const FormulaHealthSchema = z
  .object({
    ok: z.literal(true),
    model: z.string().trim().min(1).max(200).optional()
  })
  .passthrough();

const supportedMimeTypes = [
  "image/png",
  "image/webp",
  "image/jpeg"
] as const;
type SupportedFormulaMimeType = (typeof supportedMimeTypes)[number];

export class FormulaProviderError extends Error {
  code: string;
  status: number;

  constructor(message: string, code: string, status = 502) {
    super(message);
    this.name = "FormulaProviderError";
    this.code = code;
    this.status = status;
  }
}

function normalizeBaseUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function formulaTimeout(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return DEFAULT_FORMULA_TIMEOUT_MS;
  }
  return Math.min(
    MAX_FORMULA_TIMEOUT_MS,
    Math.max(MIN_FORMULA_TIMEOUT_MS, parsed)
  );
}

export function resolveFormulaProviderConfig(
  environment: FormulaOcrEnvironment
): FormulaProviderConfig {
  const requestedBaseUrl = environment.FORMULA_OCR_BASE_URL?.trim() ?? "";
  const baseUrl = requestedBaseUrl
    ? normalizeBaseUrl(requestedBaseUrl)
    : "";
  const configurationError =
    requestedBaseUrl && !baseUrl
      ? "FORMULA_OCR_BASE_URL must be a valid http:// or https:// URL."
      : undefined;

  return {
    label: "Formula OCR",
    baseUrl: baseUrl ?? "",
    apiKey: environment.FORMULA_OCR_API_KEY?.trim() ?? "",
    timeoutMs: formulaTimeout(environment.FORMULA_OCR_TIMEOUT_MS),
    configured: Boolean(baseUrl) && !configurationError,
    configurationError
  };
}

function endpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function normalizedMimeType(value: string | null | undefined): string {
  return value?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function isPng(bytes: Uint8Array): boolean {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return (
    bytes.length >= signature.length &&
    signature.every((byte, index) => bytes[index] === byte)
  );
}

function isJpeg(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  );
}

function isWebp(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  );
}

function matchesDeclaredType(
  mimeType: SupportedFormulaMimeType,
  bytes: Uint8Array
): boolean {
  if (mimeType === "image/png") return isPng(bytes);
  if (mimeType === "image/jpeg") return isJpeg(bytes);
  return isWebp(bytes);
}

export function validateFormulaImage(
  image: ArrayBuffer | Uint8Array,
  contentType: string | null | undefined
): {
  bytes: Uint8Array<ArrayBuffer>;
  mimeType: SupportedFormulaMimeType;
} {
  const mimeType = normalizedMimeType(contentType);
  if (
    !supportedMimeTypes.includes(mimeType as SupportedFormulaMimeType)
  ) {
    throw new FormulaProviderError(
      "Formula recognition accepts PNG, WebP, or JPEG images.",
      "UNSUPPORTED_FORMULA_IMAGE",
      415
    );
  }

  const bytes =
    image instanceof Uint8Array ? image : new Uint8Array(image);
  if (bytes.byteLength === 0) {
    throw new FormulaProviderError(
      "The formula image is empty.",
      "INVALID_FORMULA_IMAGE",
      400
    );
  }
  if (bytes.byteLength > MAX_FORMULA_IMAGE_BYTES) {
    throw new FormulaProviderError(
      "The formula image exceeds the 2 MiB limit.",
      "FORMULA_IMAGE_TOO_LARGE",
      413
    );
  }
  if (
    !matchesDeclaredType(mimeType as SupportedFormulaMimeType, bytes)
  ) {
    throw new FormulaProviderError(
      "The formula image does not match its declared image type.",
      "INVALID_FORMULA_IMAGE",
      400
    );
  }

  // Copy the view so a pooled Node Buffer cannot expose unrelated bytes when it
  // is passed to fetch as an ArrayBuffer-backed body.
  const ownedBytes = new Uint8Array(bytes.byteLength);
  ownedBytes.set(bytes);
  return {
    bytes: ownedBytes,
    mimeType: mimeType as SupportedFormulaMimeType
  };
}

function providerHeaders(
  config: FormulaProviderConfig,
  additional: Record<string, string> = {}
): Record<string, string> {
  return {
    Accept: "application/json",
    ...(config.apiKey
      ? { Authorization: `Bearer ${config.apiKey}` }
      : {}),
    ...additional
  };
}

async function readLimitedText(
  response: Response,
  maximumBytes: number
): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new FormulaProviderError(
      "Formula OCR returned an invalid response.",
      "INVALID_FORMULA_RESPONSE"
    );
  }

  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maximumBytes) {
      await reader.cancel().catch(() => undefined);
      throw new FormulaProviderError(
        "Formula OCR returned an invalid response.",
        "INVALID_FORMULA_RESPONSE"
      );
    }
    chunks.push(value);
  }

  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

async function parseRecognitionResponse(
  response: Response
): Promise<FormulaRecognition> {
  const contentType = normalizedMimeType(response.headers.get("content-type"));
  if (contentType !== "application/json") {
    await response.body?.cancel().catch(() => undefined);
    throw new FormulaProviderError(
      "Formula OCR returned an invalid response.",
      "INVALID_FORMULA_RESPONSE"
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(
      await readLimitedText(response, MAX_FORMULA_RESPONSE_BYTES)
    );
  } catch (error) {
    if (error instanceof FormulaProviderError) throw error;
    throw new FormulaProviderError(
      "Formula OCR returned an invalid response.",
      "INVALID_FORMULA_RESPONSE"
    );
  }

  const recognition = FormulaRecognitionSchema.safeParse(body);
  if (!recognition.success) {
    throw new FormulaProviderError(
      "Formula OCR returned an invalid response.",
      "INVALID_FORMULA_RESPONSE"
    );
  }
  return recognition.data;
}

function createRequestSignal(
  timeoutMs: number,
  upstreamSignal?: AbortSignal
): {
  signal: AbortSignal;
  timedOut: () => boolean;
  dispose: () => void;
} {
  const controller = new AbortController();
  let didTimeOut = false;
  const timeout = setTimeout(() => {
    didTimeOut = true;
    controller.abort();
  }, timeoutMs);
  const abortFromUpstream = () => controller.abort();

  if (upstreamSignal?.aborted) {
    controller.abort();
  } else {
    upstreamSignal?.addEventListener("abort", abortFromUpstream, {
      once: true
    });
  }

  return {
    signal: controller.signal,
    timedOut: () => didTimeOut,
    dispose: () => {
      clearTimeout(timeout);
      upstreamSignal?.removeEventListener("abort", abortFromUpstream);
    }
  };
}

export async function recognizeFormula(
  config: FormulaProviderConfig,
  image: ArrayBuffer | Uint8Array,
  contentType: string | null | undefined,
  upstreamSignal?: AbortSignal
): Promise<FormulaRecognition> {
  const validated = validateFormulaImage(image, contentType);
  if (!config.configured) {
    throw new FormulaProviderError(
      config.configurationError || "Formula recognition is not configured.",
      "FORMULA_PROVIDER_NOT_CONFIGURED",
      503
    );
  }

  const requestSignal = createRequestSignal(
    config.timeoutMs,
    upstreamSignal
  );

  try {
    const response = await fetch(endpoint(config.baseUrl, "v1/recognize"), {
      method: "POST",
      headers: providerHeaders(config, {
        "Content-Type": validated.mimeType
      }),
      body: validated.bytes,
      signal: requestSignal.signal,
      redirect: "error"
    });

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new FormulaProviderError(
        `Formula OCR request failed (${response.status}).`,
        "FORMULA_PROVIDER_REQUEST_FAILED"
      );
    }
    return await parseRecognitionResponse(response);
  } catch (error) {
    if (requestSignal.timedOut()) {
      throw new FormulaProviderError(
        `Formula OCR did not respond before the ${Math.round(
          config.timeoutMs / 1_000
        )} second timeout.`,
        "FORMULA_PROVIDER_TIMEOUT",
        504
      );
    }
    if (error instanceof FormulaProviderError) throw error;
    throw new FormulaProviderError(
      "Could not reach the configured formula OCR provider.",
      "FORMULA_PROVIDER_UNREACHABLE"
    );
  } finally {
    requestSignal.dispose();
  }
}

export async function getFormulaProviderStatus(
  config: FormulaProviderConfig
): Promise<FormulaRecognitionStatus> {
  const baseStatus: FormulaRecognitionStatus = {
    configured: config.configured,
    reachable: null,
    label: config.label,
    configurationError: config.configurationError
  };
  if (!config.configured) return baseStatus;

  const requestSignal = createRequestSignal(
    Math.min(config.timeoutMs, FORMULA_HEALTH_TIMEOUT_MS)
  );
  try {
    const response = await fetch(endpoint(config.baseUrl, "health"), {
      method: "GET",
      headers: providerHeaders(config),
      signal: requestSignal.signal,
      redirect: "error"
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return { ...baseStatus, reachable: false };
    }

    if (
      normalizedMimeType(response.headers.get("content-type")) !==
      "application/json"
    ) {
      await response.body?.cancel().catch(() => undefined);
      return { ...baseStatus, reachable: false };
    }

    let health: z.infer<typeof FormulaHealthSchema>;
    try {
      const parsed = FormulaHealthSchema.safeParse(
        JSON.parse(await readLimitedText(response, 8 * 1024))
      );
      if (!parsed.success) return { ...baseStatus, reachable: false };
      health = parsed.data;
    } catch {
      return { ...baseStatus, reachable: false };
    }

    return {
      ...baseStatus,
      reachable: true,
      ...(health.model ? { model: health.model } : {})
    };
  } catch {
    return { ...baseStatus, reachable: false };
  } finally {
    requestSignal.dispose();
  }
}
