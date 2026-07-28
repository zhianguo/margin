import {
  type FormulaOcrEnvironment,
  FormulaProviderError,
  getFormulaProviderStatus,
  MAX_FORMULA_IMAGE_BYTES,
  recognizeFormula,
  resolveFormulaProviderConfig
} from "./formula.js";
import {
  ExplainRequestSchema,
  generateExplanation,
  getProviderStatus,
  type LlmEnvironment,
  LlmProviderError,
  resolveProviderConfig
} from "./llm.js";

interface SitesEnvironment extends LlmEnvironment, FormulaOcrEnvironment {
  ASSETS?: {
    fetch(request: Request): Promise<Response>;
  };
}

const FORMULA_RATE_LIMIT = 20;
const FORMULA_RATE_WINDOW_MS = 60_000;
const MAX_FORMULA_RATE_BUCKETS = 10_000;
const formulaRateBuckets = new Map<
  string,
  { count: number; windowStartedAt: number }
>();

const apiHeaders = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff"
};

function jsonResponse(
  body: unknown,
  status = 200,
  additionalHeaders: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...apiHeaders, ...additionalHeaders }
  });
}

function formulaRateLimitKey(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip")?.trim() ||
    request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim() ||
    "unknown"
  );
}

function isFormulaRateLimited(request: Request): boolean {
  const now = Date.now();
  for (const [bucketKey, bucket] of formulaRateBuckets) {
    if (now - bucket.windowStartedAt >= FORMULA_RATE_WINDOW_MS) {
      formulaRateBuckets.delete(bucketKey);
    }
  }

  const key = formulaRateLimitKey(request);
  const current = formulaRateBuckets.get(key);

  if (!current || now - current.windowStartedAt >= FORMULA_RATE_WINDOW_MS) {
    formulaRateBuckets.set(key, { count: 1, windowStartedAt: now });
  } else if (current.count >= FORMULA_RATE_LIMIT) {
    return true;
  } else {
    current.count += 1;
  }

  if (formulaRateBuckets.size > MAX_FORMULA_RATE_BUCKETS) {
    while (formulaRateBuckets.size > MAX_FORMULA_RATE_BUCKETS) {
      const oldestKey = formulaRateBuckets.keys().next().value;
      if (typeof oldestKey !== "string") break;
      formulaRateBuckets.delete(oldestKey);
    }
  }
  return false;
}

async function readLimitedFormulaImage(request: Request): Promise<Uint8Array> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_FORMULA_IMAGE_BYTES
  ) {
    throw new FormulaProviderError(
      "The formula image exceeds the 2 MiB limit.",
      "FORMULA_IMAGE_TOO_LARGE",
      413
    );
  }
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_FORMULA_IMAGE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new FormulaProviderError(
        "The formula image exceeds the 2 MiB limit.",
        "FORMULA_IMAGE_TOO_LARGE",
        413
      );
    }
    chunks.push(value);
  }

  const image = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    image.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return image;
}

async function recognizeFormulaRequest(
  request: Request,
  environment: SitesEnvironment
): Promise<Response> {
  const formulaConfig = resolveFormulaProviderConfig(environment);
  try {
    const image = await readLimitedFormulaImage(request);
    return jsonResponse(
      await recognizeFormula(
        formulaConfig,
        image,
        request.headers.get("content-type"),
        request.signal
      )
    );
  } catch (error) {
    const providerError =
      error instanceof FormulaProviderError
        ? error
        : new FormulaProviderError(
            "Formula recognition failed unexpectedly.",
            "FORMULA_PROVIDER_REQUEST_FAILED"
          );
    console.error("[formula]", providerError.message);
    return jsonResponse(
      { error: providerError.message, code: providerError.code },
      providerError.status
    );
  }
}

async function explain(
  request: Request,
  environment: SitesEnvironment
): Promise<Response> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 65_536) {
    return jsonResponse(
      { error: "The explanation request is too large.", code: "INVALID_REQUEST" },
      413
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(
      { error: "The request must contain JSON.", code: "INVALID_REQUEST" },
      400
    );
  }

  const payload = ExplainRequestSchema.safeParse(body);
  if (!payload.success) {
    return jsonResponse(
      {
        error: "The selected passage or page context is invalid.",
        code: "INVALID_REQUEST"
      },
      400
    );
  }

  const providerConfig = resolveProviderConfig(environment);
  try {
    return jsonResponse(
      await generateExplanation(providerConfig, payload.data)
    );
  } catch (error) {
    const providerError =
      error instanceof LlmProviderError
        ? error
        : new LlmProviderError(
            "The explanation service failed unexpectedly.",
            "MODEL_REQUEST_FAILED"
          );
    console.error(`[explain:${providerConfig.provider}]`, providerError.message);
    return jsonResponse(
      { error: providerError.message, code: providerError.code },
      providerError.status
    );
  }
}

async function handleRequest(
  request: Request,
  environment: SitesEnvironment
): Promise<Response> {
  const url = new URL(request.url);
  const providerConfig = resolveProviderConfig(environment);
  const formulaProviderConfig = resolveFormulaProviderConfig(environment);

  if (url.pathname === "/api/health" && request.method === "GET") {
    const [llmStatus, formulaStatus] = await Promise.all([
      getProviderStatus(providerConfig),
      getFormulaProviderStatus(formulaProviderConfig)
    ]);
    return jsonResponse({
      ok: true,
      ...llmStatus,
      formulaRecognition: formulaStatus
    });
  }

  if (url.pathname === "/api/explain") {
    if (request.method !== "POST") {
      return jsonResponse(
        { error: "Method not allowed.", code: "METHOD_NOT_ALLOWED" },
        405
      );
    }
    return explain(request, environment);
  }

  if (url.pathname === "/api/formula/recognize") {
    if (request.method !== "POST") {
      return jsonResponse(
        { error: "Method not allowed.", code: "METHOD_NOT_ALLOWED" },
        405
      );
    }
    if (isFormulaRateLimited(request)) {
      return jsonResponse(
        {
          error:
            "Too many formula recognition requests. Please wait a moment and try again.",
          code: "RATE_LIMITED"
        },
        429,
        { "Retry-After": "60" }
      );
    }
    return recognizeFormulaRequest(request, environment);
  }

  if (!environment.ASSETS) {
    return new Response("Static asset binding is unavailable.", { status: 503 });
  }

  const assetResponse = await environment.ASSETS.fetch(request);
  if (!assetResponse.headers.get("content-type")?.includes("text/html")) {
    return assetResponse;
  }

  const headers = new Headers(assetResponse.headers);
  headers.set(
    "Content-Security-Policy",
    "default-src 'self'; base-uri 'self'; connect-src 'self' blob:; font-src 'self' data:; img-src 'self' data: blob:; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:"
  );
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(assetResponse.body, {
    status: assetResponse.status,
    statusText: assetResponse.statusText,
    headers
  });
}

export default {
  fetch(request: Request, environment: SitesEnvironment): Promise<Response> {
    return handleRequest(request, environment).catch((error: unknown) => {
      console.error(
        "[worker]",
        error instanceof Error ? error.message : "Unexpected worker error."
      );
      return jsonResponse(
        {
          error: "The application failed unexpectedly.",
          code: "INTERNAL_ERROR"
        },
        500
      );
    });
  }
};
