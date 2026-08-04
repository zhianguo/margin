export type WebSearchProvider = "none" | "searxng" | "tavily";

export type WebSearchFreshness =
  | "any"
  | "day"
  | "week"
  | "month"
  | "year";

export interface WebSearchEnvironment {
  WEB_SEARCH_PROVIDER?: string;
  WEB_SEARCH_BASE_URL?: string;
  WEB_SEARCH_API_KEY?: string;
  WEB_SEARCH_MAX_RESULTS?: string;
  WEB_SEARCH_TIMEOUT_MS?: string;
  SEARXNG_BASE_URL?: string;
  SEARXNG_API_KEY?: string;
  TAVILY_API_KEY?: string;
  TAVILY_BASE_URL?: string;
}

export interface WebSearchConfig {
  provider: WebSearchProvider;
  providerLabel: string;
  baseUrl: string;
  apiKey: string;
  maxResults: number;
  timeoutMs: number;
  enabled: boolean;
  configured: boolean;
  configurationError?: string;
}

export interface WebSearchStatus {
  provider: WebSearchProvider;
  providerLabel: string;
  enabled: boolean;
  configured: boolean;
  configurationError?: string;
}

export interface WebSearchSource {
  id: string;
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string;
}

export interface WebSearchResult {
  provider: Exclude<WebSearchProvider, "none">;
  query: string;
  freshness: WebSearchFreshness;
  searchedAt: string;
  sources: WebSearchSource[];
}

export interface WebSearchRequest {
  query: string;
  freshness?: WebSearchFreshness;
  maxResults?: number;
}

export class WebSearchError extends Error {
  code: string;
  status: number;

  constructor(message: string, code: string, status = 502) {
    super(message);
    this.name = "WebSearchError";
    this.code = code;
    this.status = status;
  }
}

const DEFAULT_MAX_RESULTS = 5;
const MAX_MAX_RESULTS = 10;
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_QUERY_LENGTH = 500;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_URL_LENGTH = 2_048;
const MAX_TITLE_LENGTH = 300;
const MAX_SNIPPET_LENGTH = 2_000;
const MAX_PUBLISHED_AT_LENGTH = 100;

const freshnessValues: readonly WebSearchFreshness[] = [
  "any",
  "day",
  "week",
  "month",
  "year"
];

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeBaseUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password
    ) {
      return null;
    }
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function isRealApiKey(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return Boolean(
    normalized &&
      normalized !== "no-key" &&
      normalized !== "changeme" &&
      !normalized.includes("your_api_key_here")
  );
}

export function resolveWebSearchConfig(
  environment: WebSearchEnvironment
): WebSearchConfig {
  const requestedProvider =
    environment.WEB_SEARCH_PROVIDER?.trim().toLowerCase() ?? "";
  const maxResults = boundedInteger(
    environment.WEB_SEARCH_MAX_RESULTS,
    DEFAULT_MAX_RESULTS,
    1,
    MAX_MAX_RESULTS
  );
  const timeoutMs = positiveInteger(
    environment.WEB_SEARCH_TIMEOUT_MS,
    DEFAULT_TIMEOUT_MS
  );

  if (!requestedProvider) {
    return {
      provider: "none",
      providerLabel: "Disabled",
      baseUrl: "",
      apiKey: "",
      maxResults,
      timeoutMs,
      enabled: false,
      configured: false
    };
  }

  if (requestedProvider !== "searxng" && requestedProvider !== "tavily") {
    return {
      provider: "none",
      providerLabel: "Disabled",
      baseUrl: "",
      apiKey: "",
      maxResults,
      timeoutMs,
      enabled: false,
      configured: false,
      configurationError: `Unsupported WEB_SEARCH_PROVIDER "${requestedProvider}". Use "searxng" or "tavily".`
    };
  }

  if (requestedProvider === "searxng") {
    const configuredBaseUrl =
      environment.SEARXNG_BASE_URL?.trim() ||
      environment.WEB_SEARCH_BASE_URL?.trim() ||
      "http://127.0.0.1:8888";
    const baseUrl = normalizeBaseUrl(configuredBaseUrl);
    const configurationError = !baseUrl
      ? "SEARXNG_BASE_URL (or WEB_SEARCH_BASE_URL) must be a valid http:// or https:// URL."
      : undefined;

    return {
      provider: "searxng",
      providerLabel: "SearXNG",
      baseUrl: baseUrl ?? "",
      apiKey:
        environment.SEARXNG_API_KEY?.trim() ||
        environment.WEB_SEARCH_API_KEY?.trim() ||
        "",
      maxResults,
      timeoutMs,
      enabled: true,
      configured: !configurationError,
      configurationError
    };
  }

  const configuredBaseUrl =
    environment.TAVILY_BASE_URL?.trim() ||
    environment.WEB_SEARCH_BASE_URL?.trim() ||
    "https://api.tavily.com";
  const baseUrl = normalizeBaseUrl(configuredBaseUrl);
  const apiKey =
    environment.TAVILY_API_KEY?.trim() ||
    environment.WEB_SEARCH_API_KEY?.trim() ||
    "";
  const configurationError = !baseUrl
    ? "TAVILY_BASE_URL (or WEB_SEARCH_BASE_URL) must be a valid http:// or https:// URL."
    : !isRealApiKey(apiKey)
      ? "Add TAVILY_API_KEY (or WEB_SEARCH_API_KEY) and restart the API server."
      : undefined;

  return {
    provider: "tavily",
    providerLabel: "Tavily",
    baseUrl: baseUrl ?? "",
    apiKey,
    maxResults,
    timeoutMs,
    enabled: true,
    configured: !configurationError,
    configurationError
  };
}

export function getWebSearchStatus(
  config: WebSearchConfig
): WebSearchStatus {
  return {
    provider: config.provider,
    providerLabel: config.providerLabel,
    enabled: config.enabled,
    configured: config.configured,
    configurationError: config.configurationError
  };
}

function endpoint(baseUrl: string, path: string): URL {
  const url = new URL(`${baseUrl.replace(/\/+$/, "")}/`);
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
  return url;
}

function decodeEntities(value: string): string {
  const namedEntities: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"'
  };

  return value.replace(
    /&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|([a-z]{2,8}));/gi,
    (entity, decimal: string, hexadecimal: string, named: string) => {
      const numericValue = decimal
        ? Number.parseInt(decimal, 10)
        : hexadecimal
          ? Number.parseInt(hexadecimal, 16)
          : null;
      if (numericValue !== null) {
        if (
          !Number.isInteger(numericValue) ||
          numericValue <= 0 ||
          numericValue > 0x10ffff ||
          (numericValue >= 0xd800 && numericValue <= 0xdfff)
        ) {
          return " ";
        }
        return String.fromCodePoint(numericValue);
      }
      return namedEntities[named.toLowerCase()] ?? entity;
    }
  );
}

function plainText(value: unknown, maximumLength: number): string {
  if (typeof value !== "string") return "";

  const decoded = decodeEntities(value);
  const withoutMarkup = decoded
    .replace(
      /<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
      " "
    )
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/?[a-z][^>]*>/gi, " ")
    .replace(/[<>]/g, " ");
  return withoutMarkup
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximumLength);
}

function normalizedQuery(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_QUERY_LENGTH + 1);
}

function safeResultUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const rawUrl = value.trim();
  if (!rawUrl || rawUrl.length > MAX_URL_LENGTH) return null;

  try {
    const url = new URL(rawUrl);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password
    ) {
      return null;
    }
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function firstPlainText(
  result: Record<string, unknown>,
  keys: readonly string[],
  maximumLength: number
): string {
  for (const key of keys) {
    const value = plainText(result[key], maximumLength);
    if (value) return value;
  }
  return "";
}

function normalizeSources(
  rawResults: unknown[],
  maximumResults: number
): WebSearchSource[] {
  const sources: WebSearchSource[] = [];
  const seenUrls = new Set<string>();

  for (const rawResult of rawResults) {
    if (
      !rawResult ||
      typeof rawResult !== "object" ||
      Array.isArray(rawResult)
    ) {
      continue;
    }
    const result = rawResult as Record<string, unknown>;
    const url = safeResultUrl(result.url);
    if (!url || seenUrls.has(url)) continue;

    const title = plainText(result.title, MAX_TITLE_LENGTH);
    if (!title) continue;
    const snippet = firstPlainText(
      result,
      ["content", "snippet", "description"],
      MAX_SNIPPET_LENGTH
    );
    const publishedAt = firstPlainText(
      result,
      [
        "publishedAt",
        "published_at",
        "publishedDate",
        "published_date",
        "publication_date",
        "date",
        "published"
      ],
      MAX_PUBLISHED_AT_LENGTH
    );

    seenUrls.add(url);
    sources.push({
      id: `S${sources.length + 1}`,
      title,
      url,
      snippet,
      ...(publishedAt ? { publishedAt } : {})
    });
    if (sources.length >= maximumResults) break;
  }

  return sources;
}

function normalizeRequest(
  config: WebSearchConfig,
  request: WebSearchRequest
): Required<WebSearchRequest> {
  const query = normalizedQuery(request.query);
  if (!query || query.length > MAX_QUERY_LENGTH) {
    throw new WebSearchError(
      `The web search query must contain between 1 and ${MAX_QUERY_LENGTH} characters.`,
      "INVALID_WEB_SEARCH_REQUEST",
      400
    );
  }

  const freshness = request.freshness ?? "any";
  if (!freshnessValues.includes(freshness)) {
    throw new WebSearchError(
      "The requested web search freshness is invalid.",
      "INVALID_WEB_SEARCH_REQUEST",
      400
    );
  }

  const requestedMaximum =
    request.maxResults === undefined
      ? config.maxResults
      : Number.isFinite(request.maxResults)
        ? Math.min(
            MAX_MAX_RESULTS,
            Math.max(1, Math.trunc(request.maxResults))
          )
        : config.maxResults;

  return {
    query,
    freshness,
    maxResults: Math.min(config.maxResults, requestedMaximum)
  };
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

async function readLimitedText(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_RESPONSE_BYTES
  ) {
    await response.body?.cancel().catch(() => undefined);
    throw new WebSearchError(
      "The search provider returned an invalid result.",
      "INVALID_WEB_SEARCH_RESPONSE"
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
    if (totalBytes > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new WebSearchError(
        "The search provider returned an invalid result.",
        "INVALID_WEB_SEARCH_RESPONSE"
      );
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function parseProviderResults(response: Response): Promise<unknown[]> {
  let body: unknown;
  try {
    body = JSON.parse(await readLimitedText(response));
  } catch (error) {
    if (error instanceof WebSearchError) throw error;
    throw new WebSearchError(
      "The search provider returned invalid JSON.",
      "INVALID_WEB_SEARCH_RESPONSE"
    );
  }

  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    !Array.isArray((body as { results?: unknown }).results)
  ) {
    throw new WebSearchError(
      "The search provider returned an invalid result.",
      "INVALID_WEB_SEARCH_RESPONSE"
    );
  }
  return (body as { results: unknown[] }).results;
}

function searchRequest(
  config: WebSearchConfig,
  request: Required<WebSearchRequest>,
  signal: AbortSignal
): { url: URL; init: RequestInit } {
  const headers = new Headers({ Accept: "application/json" });
  if (config.apiKey) {
    headers.set("Authorization", `Bearer ${config.apiKey}`);
  }

  if (config.provider === "searxng") {
    const url = endpoint(config.baseUrl, "search");
    url.searchParams.set("q", request.query);
    url.searchParams.set("format", "json");
    url.searchParams.set("language", "auto");
    url.searchParams.set("safesearch", "1");
    if (request.freshness !== "any") {
      url.searchParams.set("time_range", request.freshness);
    }
    return {
      url,
      init: {
        method: "GET",
        headers,
        signal,
        redirect: "error"
      }
    };
  }

  headers.set("Content-Type", "application/json");
  const body = {
    query: request.query,
    search_depth: "basic",
    max_results: request.maxResults,
    include_answer: false,
    include_raw_content: false,
    include_images: false,
    ...(request.freshness !== "any"
      ? { time_range: request.freshness }
      : {})
  };
  return {
    url: endpoint(config.baseUrl, "search"),
    init: {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
      redirect: "error"
    }
  };
}

export async function searchWeb(
  config: WebSearchConfig,
  request: WebSearchRequest,
  upstreamSignal?: AbortSignal
): Promise<WebSearchResult> {
  if (upstreamSignal?.aborted) {
    throw new WebSearchError(
      "The web search request was cancelled.",
      "WEB_SEARCH_ABORTED",
      499
    );
  }
  if (!config.configured || config.provider === "none") {
    throw new WebSearchError(
      config.configurationError || "Web search is not configured.",
      "WEB_SEARCH_NOT_CONFIGURED",
      503
    );
  }

  const normalizedRequest = normalizeRequest(config, request);
  const requestSignal = createRequestSignal(
    config.timeoutMs,
    upstreamSignal
  );

  try {
    const providerRequest = searchRequest(
      config,
      normalizedRequest,
      requestSignal.signal
    );
    const response = await fetch(providerRequest.url, providerRequest.init);
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new WebSearchError(
        `${config.providerLabel} search request failed (${response.status}).`,
        "WEB_SEARCH_REQUEST_FAILED"
      );
    }

    const rawResults = await parseProviderResults(response);
    return {
      provider: config.provider,
      query: normalizedRequest.query,
      freshness: normalizedRequest.freshness,
      searchedAt: new Date().toISOString(),
      sources: normalizeSources(rawResults, normalizedRequest.maxResults)
    };
  } catch (error) {
    if (requestSignal.timedOut()) {
      throw new WebSearchError(
        `${config.providerLabel} did not respond before the ${Math.round(
          Math.max(1_000, config.timeoutMs) / 1_000
        )} second timeout.`,
        "WEB_SEARCH_TIMEOUT",
        504
      );
    }
    if (upstreamSignal?.aborted) {
      throw new WebSearchError(
        "The web search request was cancelled.",
        "WEB_SEARCH_ABORTED",
        499
      );
    }
    if (error instanceof WebSearchError) throw error;
    throw new WebSearchError(
      `Could not reach the configured ${config.providerLabel} search provider.`,
      "WEB_SEARCH_UNREACHABLE"
    );
  } finally {
    requestSignal.dispose();
  }
}
