// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getWebSearchStatus,
  resolveWebSearchConfig,
  searchWeb,
  WebSearchError,
  type WebSearchConfig
} from "./search.js";

function searxngConfig(
  overrides: Partial<WebSearchConfig> = {}
): WebSearchConfig {
  return {
    provider: "searxng",
    providerLabel: "SearXNG",
    baseUrl: "https://search.example.test/root",
    apiKey: "",
    maxResults: 5,
    timeoutMs: 10_000,
    enabled: true,
    configured: true,
    ...overrides
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function credentialBearingUrl(): string {
  const url = new URL("https://example.test/secret");
  url.username = "reader";
  url.password = "token";
  return url.toString();
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("resolveWebSearchConfig", () => {
  it("keeps search disabled when no provider is selected", () => {
    const config = resolveWebSearchConfig({});

    expect(config).toMatchObject({
      provider: "none",
      providerLabel: "Disabled",
      enabled: false,
      configured: false,
      maxResults: 5,
      timeoutMs: 10_000
    });
    expect(config.configurationError).toBeUndefined();
  });

  it("uses the local SearXNG default only when explicitly selected", () => {
    expect(
      resolveWebSearchConfig({ WEB_SEARCH_PROVIDER: " SeArXnG " })
    ).toMatchObject({
      provider: "searxng",
      baseUrl: "http://127.0.0.1:8888",
      enabled: true,
      configured: true
    });
  });

  it("normalizes provider settings and bounds numeric settings", () => {
    const config = resolveWebSearchConfig({
      WEB_SEARCH_PROVIDER: "searxng",
      WEB_SEARCH_BASE_URL: "https://generic.example.test/",
      WEB_SEARCH_API_KEY: "generic-key",
      WEB_SEARCH_MAX_RESULTS: "99",
      WEB_SEARCH_TIMEOUT_MS: "2500",
      SEARXNG_BASE_URL: "https://specific.example.test/searx/",
      SEARXNG_API_KEY: "specific-key"
    });

    expect(config).toMatchObject({
      baseUrl: "https://specific.example.test/searx",
      apiKey: "specific-key",
      maxResults: 10,
      timeoutMs: 2_500
    });
    expect(
      resolveWebSearchConfig({
        WEB_SEARCH_PROVIDER: "searxng",
        WEB_SEARCH_MAX_RESULTS: "0",
        WEB_SEARCH_TIMEOUT_MS: "invalid"
      })
    ).toMatchObject({ maxResults: 1, timeoutMs: 10_000 });
  });

  it("rejects unsupported providers and invalid URLs", () => {
    const unsupported = resolveWebSearchConfig({
      WEB_SEARCH_PROVIDER: "duckduckgo"
    });
    const invalidUrl = resolveWebSearchConfig({
      WEB_SEARCH_PROVIDER: "searxng",
      SEARXNG_BASE_URL: "file:///tmp/search"
    });

    expect(unsupported).toMatchObject({
      provider: "none",
      configured: false,
      enabled: false
    });
    expect(unsupported.configurationError).toContain(
      "Unsupported WEB_SEARCH_PROVIDER"
    );
    expect(invalidUrl.configured).toBe(false);
    expect(invalidUrl.configurationError).toContain("SEARXNG_BASE_URL");
  });

  it("defaults Tavily's URL and requires a non-placeholder API key", () => {
    const missing = resolveWebSearchConfig({
      WEB_SEARCH_PROVIDER: "tavily"
    });
    const placeholder = resolveWebSearchConfig({
      WEB_SEARCH_PROVIDER: "tavily",
      TAVILY_API_KEY: "your_api_key_here"
    });
    const configured = resolveWebSearchConfig({
      WEB_SEARCH_PROVIDER: "tavily",
      TAVILY_API_KEY: "tvly-test-key"
    });

    expect(missing.configured).toBe(false);
    expect(missing.configurationError).toContain("TAVILY_API_KEY");
    expect(placeholder.configured).toBe(false);
    expect(configured).toMatchObject({
      provider: "tavily",
      baseUrl: "https://api.tavily.com",
      apiKey: "tvly-test-key",
      configured: true
    });
  });

  it("reports status without probing the provider", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const config = resolveWebSearchConfig({
      WEB_SEARCH_PROVIDER: "searxng"
    });

    expect(getWebSearchStatus(config)).toEqual({
      provider: "searxng",
      providerLabel: "SearXNG",
      enabled: true,
      configured: true,
      configurationError: undefined
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("searchWeb", () => {
  it("sends a bounded authenticated SearXNG JSON search", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ results: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await searchWeb(
      searxngConfig({ apiKey: "searx-secret", maxResults: 3 }),
      {
        query: "  latest   margin research ",
        freshness: "month",
        maxResults: 9
      }
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const [requestUrl, init] = fetchMock.mock.calls[0] as [
      URL,
      RequestInit
    ];
    expect(requestUrl.origin + requestUrl.pathname).toBe(
      "https://search.example.test/root/search"
    );
    expect(requestUrl.searchParams.get("q")).toBe(
      "latest margin research"
    );
    expect(requestUrl.searchParams.get("format")).toBe("json");
    expect(requestUrl.searchParams.get("language")).toBe("auto");
    expect(requestUrl.searchParams.get("safesearch")).toBe("1");
    expect(requestUrl.searchParams.get("time_range")).toBe("month");
    expect(init.method).toBe("GET");
    expect(new Headers(init.headers).get("authorization")).toBe(
      "Bearer searx-secret"
    );
    expect(init.redirect).toBe("error");
  });

  it("parses, sanitizes, deduplicates, and bounds SearXNG results", async () => {
    const longSnippet = "x".repeat(2_100);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          results: [
            {
              title: "<b>Useful &amp; current</b>",
              url: "https://example.test/article#section",
              content: `<script>doBadThings()</script><p>${longSnippet}</p>`,
              publishedDate: "2026-07-28"
            },
            {
              title: "Duplicate",
              url: "https://example.test/article#other",
              content: "duplicate"
            },
            {
              title: "Unsafe",
              url: "javascript:alert(1)",
              content: "must not appear"
            },
            {
              title: "Credential URL",
              url: credentialBearingUrl(),
              content: "must not appear"
            },
            {
              title: "Second",
              url: "http://second.example.test/path",
              snippet: "A <em>plain</em> snippet.",
              published_at: "yesterday"
            },
            {
              title: "Third",
              url: "https://third.example.test/",
              content: "excluded by the result bound"
            }
          ]
        })
      )
    );

    const result = await searchWeb(
      searxngConfig({ maxResults: 2 }),
      { query: "news", maxResults: 2 }
    );

    expect(result).toMatchObject({
      provider: "searxng",
      query: "news",
      freshness: "any"
    });
    expect(result.searchedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/
    );
    expect(result.sources).toHaveLength(2);
    expect(result.sources[0]).toMatchObject({
      title: "Useful & current",
      url: "https://example.test/article",
      publishedAt: "2026-07-28"
    });
    expect(result.sources[0]?.id).toBe("S1");
    expect(result.sources[1]?.id).toBe("S2");
    expect(result.sources[0]?.snippet).toHaveLength(2_000);
    expect(result.sources[0]?.snippet).not.toContain("<");
    expect(result.sources[0]?.snippet).not.toContain("doBadThings");
    expect(result.sources[1]).toMatchObject({
      title: "Second",
      url: "http://second.example.test/path",
      snippet: "A plain snippet.",
      publishedAt: "yesterday"
    });
  });

  it("posts a safe, minimal Tavily request and parses its results", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        results: [
          {
            title: "Release notes",
            url: "https://vendor.example.test/releases",
            content: "The current release.",
            published_date: "2026-07-27"
          }
        ]
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const config = resolveWebSearchConfig({
      WEB_SEARCH_PROVIDER: "tavily",
      TAVILY_BASE_URL: "https://tavily.example.test/api/",
      TAVILY_API_KEY: "tvly-secret",
      WEB_SEARCH_MAX_RESULTS: "4"
    });

    const result = await searchWeb(config, {
      query: "current release",
      freshness: "week"
    });

    const [requestUrl, init] = fetchMock.mock.calls[0] as [
      URL,
      RequestInit
    ];
    expect(requestUrl.toString()).toBe(
      "https://tavily.example.test/api/search"
    );
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("authorization")).toBe(
      "Bearer tvly-secret"
    );
    expect(new Headers(init.headers).get("content-type")).toBe(
      "application/json"
    );
    expect(JSON.parse(String(init.body))).toEqual({
      query: "current release",
      search_depth: "basic",
      max_results: 4,
      include_answer: false,
      include_raw_content: false,
      include_images: false,
      time_range: "week"
    });
    expect(result.sources[0]).toMatchObject({
      title: "Release notes",
      snippet: "The current release.",
      publishedAt: "2026-07-27"
    });
  });

  it("omits freshness when Tavily should search any date", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ results: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await searchWeb(
      resolveWebSearchConfig({
        WEB_SEARCH_PROVIDER: "tavily",
        TAVILY_API_KEY: "tvly-test-key"
      }),
      { query: "timeless topic" }
    );

    const body = JSON.parse(
      String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)
    );
    expect(body).not.toHaveProperty("time_range");
  });

  it("returns stable configuration and validation errors", async () => {
    const disabled = resolveWebSearchConfig({});

    await expect(
      searchWeb(disabled, { query: "news" })
    ).rejects.toMatchObject({
      code: "WEB_SEARCH_NOT_CONFIGURED",
      status: 503
    });
    await expect(
      searchWeb(searxngConfig(), { query: " " })
    ).rejects.toMatchObject({
      code: "INVALID_WEB_SEARCH_REQUEST",
      status: 400
    });
    await expect(
      searchWeb(searxngConfig(), {
        query: "news",
        freshness: "century" as never
      })
    ).rejects.toMatchObject({
      code: "INVALID_WEB_SEARCH_REQUEST",
      status: 400
    });
  });

  it("honors cancellation before checking provider configuration", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    controller.abort();

    await expect(
      searchWeb(
        resolveWebSearchConfig({}),
        { query: "news" },
        controller.signal
      )
    ).rejects.toMatchObject({
      code: "WEB_SEARCH_ABORTED",
      status: 499
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns stable errors for non-success and invalid provider responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response("<html>denied</html>", { status: 429 }))
        .mockResolvedValueOnce(new Response("<html>not JSON</html>"))
        .mockResolvedValueOnce(jsonResponse({ answer: "missing results" }))
    );

    await expect(
      searchWeb(searxngConfig(), { query: "first" })
    ).rejects.toMatchObject({
      code: "WEB_SEARCH_REQUEST_FAILED",
      status: 502
    });
    await expect(
      searchWeb(searxngConfig(), { query: "second" })
    ).rejects.toMatchObject({
      code: "INVALID_WEB_SEARCH_RESPONSE",
      status: 502
    });
    await expect(
      searchWeb(searxngConfig(), { query: "third" })
    ).rejects.toMatchObject({
      code: "INVALID_WEB_SEARCH_RESPONSE",
      status: 502
    });
  });

  it("distinguishes unreachable providers, timeouts, and caller cancellation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValueOnce(new TypeError("network failed"))
    );
    await expect(
      searchWeb(searxngConfig(), { query: "unreachable" })
    ).rejects.toMatchObject({
      code: "WEB_SEARCH_UNREACHABLE",
      status: 502
    });

    vi.useFakeTimers();
    const waitForAbort = vi.fn(
      (_url: URL, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true }
          );
        })
    );
    vi.stubGlobal("fetch", waitForAbort);
    const timeoutPromise = searchWeb(
      searxngConfig({ timeoutMs: 25 }),
      { query: "slow" }
    );
    const timeoutExpectation = expect(timeoutPromise).rejects.toMatchObject({
      code: "WEB_SEARCH_TIMEOUT",
      status: 504
    });
    await vi.advanceTimersByTimeAsync(25);
    await timeoutExpectation;

    vi.useRealTimers();
    const abortController = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: URL, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener(
              "abort",
              () => reject(new DOMException("aborted", "AbortError")),
              { once: true }
            );
          })
      )
    );
    const abortedPromise = searchWeb(
      searxngConfig(),
      { query: "cancel me" },
      abortController.signal
    );
    abortController.abort();
    await expect(abortedPromise).rejects.toMatchObject({
      code: "WEB_SEARCH_ABORTED",
      status: 499
    });
  });

  it("exposes typed provider errors", () => {
    const error = new WebSearchError("failed", "TEST_CODE", 418);
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({
      name: "WebSearchError",
      message: "failed",
      code: "TEST_CODE",
      status: 418
    });
  });
});
