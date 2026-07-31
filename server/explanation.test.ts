import { afterEach, describe, expect, it, vi } from "vitest";
import { generateSearchAwareExplanation } from "./explanation.js";
import {
  ExplainRequestSchema,
  resolveProviderConfig
} from "./llm.js";
import {
  resolveWebSearchConfig
} from "./search.js";

const ordinaryExplanation = {
  title: "Feedback",
  summary: "The passage describes a feedback loop.",
  intuition: "The output is returned to the input.",
  details: ["The loop changes the system response."],
  terms: [{ term: "feedback", meaning: "A returned output signal." }],
  equations: [],
  connections: ["This is common in control systems."],
  checkQuestion: "What signal is returned?",
  uncertainty: ""
};

const payload = ExplainRequestSchema.parse({
  selectedText: "The feedback loop remains stable.",
  pageContext: "A page about control systems.",
  pageNumber: 5,
  documentTitle: "Control.pdf",
  mode: "plain",
  webSearch: {
    query: "recent feedback control research",
    freshness: "month"
  }
});

const providerConfig = resolveProviderConfig({
  LLM_PROVIDER: "llamacpp",
  LLAMACPP_BASE_URL: "http://model.test/v1",
  LLAMACPP_MODEL: "margin-local"
});

const searchConfig = resolveWebSearchConfig({
  WEB_SEARCH_PROVIDER: "searxng",
  SEARXNG_BASE_URL: "http://search.test"
});

function completion(content: unknown): Response {
  return Response.json({
    model: "margin-local",
    choices: [
      {
        finish_reason: "stop",
        message: { content: JSON.stringify(content) }
      }
    ]
  });
}

function searchResponse(results: unknown[]): Response {
  return Response.json({ results });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("generateSearchAwareExplanation", () => {
  it("falls back to an ordinary explanation when search is unavailable", async () => {
    const fetchMock = vi.fn().mockResolvedValue(completion(ordinaryExplanation));
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateSearchAwareExplanation(
      providerConfig,
      resolveWebSearchConfig({}),
      payload
    );

    expect(result.explanation).toEqual(ordinaryExplanation);
    expect(result.webContext).toBeUndefined();
    expect(result.webSearchWarning).toMatchObject({
      code: "WEB_SEARCH_NOT_CONFIGURED"
    });
    expect(result.webSearchWarning?.message).toContain(
      "generated without current web sources"
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "http://model.test/v1/chat/completions"
    );
    const modelRequest = JSON.parse(
      String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)
    );
    expect(modelRequest.messages[1].content).not.toContain("<web_sources");
  });

  it("falls back when the provider returns no usable results", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(searchResponse([]))
      .mockResolvedValueOnce(completion(ordinaryExplanation));
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateSearchAwareExplanation(
      providerConfig,
      searchConfig,
      payload
    );

    expect(result.webSearchWarning).toMatchObject({
      code: "WEB_SEARCH_NO_RESULTS"
    });
    expect(result.explanation).toEqual(ordinaryExplanation);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns separately cited web context when grounding succeeds", async () => {
    const searchResults = [
      {
        title: "Current control research",
        url: "https://example.test/control",
        content: "A current result."
      }
    ];
    const groundedResponse = {
      ...ordinaryExplanation,
      webContext: {
        summary: "Recent work extends the technique.",
        claims: [
          {
            text: "A recent result extends the technique.",
            sourceIds: ["S1"]
          }
        ]
      }
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(searchResponse(searchResults))
      .mockResolvedValueOnce(completion(groundedResponse));
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateSearchAwareExplanation(
      providerConfig,
      searchConfig,
      payload
    );

    expect(result.webSearchWarning).toBeUndefined();
    expect(result.webContext).toMatchObject({
      query: "recent feedback control research",
      freshness: "month",
      claims: [
        {
          text: "A recent result extends the technique.",
          sourceIds: ["S1"]
        }
      ],
      sources: [
        {
          id: "S1",
          title: "Current control research",
          url: "https://example.test/control"
        }
      ]
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries without web context when the model cannot cite registered sources", async () => {
    const invalidGroundedResponse = {
      ...ordinaryExplanation,
      webContext: {
        summary: "Unsupported current context.",
        claims: [
          {
            text: "This claim cites an invented result.",
            sourceIds: ["S99"]
          }
        ]
      }
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        searchResponse([
          {
            title: "Current control research",
            url: "https://example.test/control",
            content: "A current result."
          }
        ])
      )
      .mockResolvedValueOnce(completion(invalidGroundedResponse))
      .mockResolvedValueOnce(completion(ordinaryExplanation));
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateSearchAwareExplanation(
      providerConfig,
      searchConfig,
      payload
    );

    expect(result.webContext).toBeUndefined();
    expect(result.webSearchWarning).toMatchObject({
      code: "INVALID_WEB_CITATIONS"
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const retryRequest = JSON.parse(
      String((fetchMock.mock.calls[2]?.[1] as RequestInit).body)
    );
    expect(retryRequest.messages[1].content).not.toContain("<web_sources");
  });

  it("does not disclose the query when the LLM is unconfigured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const unconfiguredProvider = resolveProviderConfig({
      LLM_PROVIDER: "openai"
    });

    await expect(
      generateSearchAwareExplanation(
        unconfiguredProvider,
        searchConfig,
        payload
      )
    ).rejects.toMatchObject({
      code: "MISSING_PROVIDER_CONFIG"
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not fall back after request cancellation", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    controller.abort();

    await expect(
      generateSearchAwareExplanation(
        providerConfig,
        searchConfig,
        payload,
        controller.signal
      )
    ).rejects.toMatchObject({
      code: "WEB_SEARCH_ABORTED"
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
