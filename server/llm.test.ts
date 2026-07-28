// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ExplainRequestSchema,
  generateExplanation,
  getProviderStatus,
  resolveProviderConfig,
  type ExplainRequest
} from "./llm.js";

const payload: ExplainRequest = {
  selectedText: "The closed-loop poles determine whether disturbances decay.",
  pageContext:
    "The denominator contains the characteristic equation. Its roots are the closed-loop poles.",
  pageNumber: 1,
  documentTitle: "Stability Margins",
  mode: "plain"
};

const explanation = {
  title: "Poles describe natural behavior",
  summary: "Pole locations indicate whether a system's modes decay or grow.",
  intuition: "They are the system's built-in tendencies after a disturbance.",
  details: ["Left-half-plane poles decay over time."],
  terms: [{ term: "pole", meaning: "A root of the characteristic equation." }],
  equations: [],
  connections: ["This connects frequency-domain design to time response."],
  checkQuestion: "What would a right-half-plane pole imply?",
  uncertainty: ""
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ExplainRequestSchema", () => {
  it("accepts bounded diagram layout context and rejects invalid variants", () => {
    expect(ExplainRequestSchema.parse(payload).visualContext).toBeUndefined();
    expect(
      ExplainRequestSchema.safeParse({
        ...payload,
        visualContext: {
          kind: "diagram",
          layoutText: "A  →  B\n↓     ↓\nC  →  D"
        }
      }).success
    ).toBe(true);
    expect(
      ExplainRequestSchema.safeParse({
        ...payload,
        visualContext: {
          kind: "diagram",
          layoutText: "x".repeat(8_001)
        }
      }).success
    ).toBe(false);
    expect(
      ExplainRequestSchema.safeParse({
        ...payload,
        visualContext: { kind: "formula" }
      }).success
    ).toBe(false);
  });
});

describe("resolveProviderConfig", () => {
  it("keeps the existing OpenAI environment backward compatible", () => {
    const config = resolveProviderConfig({
      OPENAI_API_KEY: "sk-test",
      OPENAI_MODEL: "test-openai-model"
    });

    expect(config).toMatchObject({
      provider: "openai",
      model: "test-openai-model",
      configured: true,
      baseUrl: "https://api.openai.com/v1"
    });
  });

  it("configures llama.cpp without borrowing an OpenAI key", () => {
    const config = resolveProviderConfig({
      LLM_PROVIDER: "llamacpp",
      LLM_BASE_URL: "http://127.0.0.1:8080/v1/",
      LLM_MODEL: "margin-local",
      OPENAI_API_KEY: "must-not-leak"
    });

    expect(config).toMatchObject({
      provider: "llamacpp",
      model: "margin-local",
      baseUrl: "http://127.0.0.1:8080/v1",
      apiKey: "no-key",
      configured: true
    });
  });

  it("uses first-class Gemini defaults with a Gemini API key", () => {
    const config = resolveProviderConfig({
      LLM_PROVIDER: " GeMiNi ",
      GEMINI_API_KEY: "gemini-test-key"
    });

    expect(config).toMatchObject({
      provider: "gemini",
      label: "Google Gemini",
      model: "gemini-3.6-flash",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      apiKey: "gemini-test-key",
      configured: true,
      maxTokens: 2048,
      temperature: 0.2,
      timeoutMs: 120_000
    });
  });

  it("supports generic LLM fallbacks for Gemini configuration", () => {
    const config = resolveProviderConfig({
      LLM_PROVIDER: "gemini",
      LLM_BASE_URL: "https://gemini-gateway.example.test/v1/",
      LLM_MODEL: "gemini-custom",
      LLM_API_KEY: "fallback-key",
      LLM_MAX_TOKENS: "3072",
      LLM_TEMPERATURE: "0.4",
      LLM_TIMEOUT_MS: "45000"
    });

    expect(config).toMatchObject({
      provider: "gemini",
      model: "gemini-custom",
      baseUrl: "https://gemini-gateway.example.test/v1",
      apiKey: "fallback-key",
      configured: true,
      maxTokens: 3072,
      temperature: 0.4,
      timeoutMs: 45_000
    });
  });

  it("requires a real API key for Gemini", () => {
    const missing = resolveProviderConfig({ LLM_PROVIDER: "gemini" });
    const placeholder = resolveProviderConfig({
      LLM_PROVIDER: "gemini",
      GEMINI_API_KEY: "your_api_key_here"
    });

    expect(missing.configured).toBe(false);
    expect(missing.configurationError).toContain("GEMINI_API_KEY");
    expect(placeholder.configured).toBe(false);
    expect(placeholder.configurationError).toContain("GEMINI_API_KEY");
  });

  it("rejects an invalid Gemini base URL", () => {
    const config = resolveProviderConfig({
      LLM_PROVIDER: "gemini",
      GEMINI_API_KEY: "gemini-test-key",
      GEMINI_BASE_URL: "file:///tmp/not-an-api"
    });

    expect(config.configured).toBe(false);
    expect(config.configurationError).toContain("GEMINI_BASE_URL");
  });

  it("configures a generic OpenAI-compatible endpoint without requiring a key", () => {
    const config = resolveProviderConfig({
      LLM_PROVIDER: "openai-compatible",
      OPENAI_COMPATIBLE_BASE_URL: "https://inference.example.test/v1/",
      OPENAI_COMPATIBLE_MODEL: "instruct-model"
    });

    expect(config).toMatchObject({
      provider: "openai-compatible",
      label: "OpenAI-compatible API",
      model: "instruct-model",
      baseUrl: "https://inference.example.test/v1",
      apiKey: "",
      configured: true,
      maxTokens: 2048,
      temperature: 0.2,
      timeoutMs: 120_000
    });

    expect(
      resolveProviderConfig({
        LLM_PROVIDER: "openai-compatible",
        OPENAI_COMPATIBLE_BASE_URL: "https://inference.example.test/v1",
        OPENAI_COMPATIBLE_MODEL: "instruct-model",
        OPENAI_COMPATIBLE_API_KEY: "no-key"
      }).apiKey
    ).toBe("");
  });

  it("supports LLM fallbacks and provider-specific overrides for compatible endpoints", () => {
    const config = resolveProviderConfig({
      LLM_PROVIDER: "openai-compatible",
      LLM_BASE_URL: "https://fallback.example.test/v1",
      LLM_MODEL: "fallback-model",
      LLM_API_KEY: "fallback-key",
      LLM_MAX_TOKENS: "1024",
      LLM_TEMPERATURE: "0.3",
      LLM_TIMEOUT_MS: "30000",
      OPENAI_COMPATIBLE_BASE_URL: "https://specific.example.test/api/",
      OPENAI_COMPATIBLE_MODEL: "specific-model",
      OPENAI_COMPATIBLE_API_KEY: "specific-key",
      OPENAI_COMPATIBLE_MAX_TOKENS: "4096",
      OPENAI_COMPATIBLE_TEMPERATURE: "0.7",
      OPENAI_COMPATIBLE_TIMEOUT_MS: "90000"
    });

    expect(config).toMatchObject({
      baseUrl: "https://specific.example.test/api",
      model: "specific-model",
      apiKey: "specific-key",
      configured: true,
      maxTokens: 4096,
      temperature: 0.7,
      timeoutMs: 90_000
    });
  });

  it("requires both a URL and model for a compatible endpoint", () => {
    const missingUrl = resolveProviderConfig({
      LLM_PROVIDER: "openai-compatible",
      OPENAI_COMPATIBLE_MODEL: "instruct-model"
    });
    const missingModel = resolveProviderConfig({
      LLM_PROVIDER: "openai-compatible",
      OPENAI_COMPATIBLE_BASE_URL: "https://inference.example.test/v1"
    });

    expect(missingUrl.configured).toBe(false);
    expect(missingUrl.configurationError).toContain(
      "OPENAI_COMPATIBLE_BASE_URL"
    );
    expect(missingModel.configured).toBe(false);
    expect(missingModel.configurationError).toContain(
      "OPENAI_COMPATIBLE_MODEL"
    );

    const invalidUrl = resolveProviderConfig({
      LLM_PROVIDER: "openai-compatible",
      OPENAI_COMPATIBLE_BASE_URL: "ftp://inference.example.test/v1",
      OPENAI_COMPATIBLE_MODEL: "instruct-model"
    });
    expect(invalidUrl.configured).toBe(false);
    expect(invalidUrl.configurationError).toContain(
      "OPENAI_COMPATIBLE_BASE_URL"
    );
  });

  it("reports unsupported providers without silently using them", () => {
    const config = resolveProviderConfig({
      LLM_PROVIDER: "unknown-provider",
      OPENAI_API_KEY: "sk-test"
    });

    expect(config.configured).toBe(false);
    expect(config.configurationError).toContain("Unsupported LLM_PROVIDER");
  });
});

describe("llama.cpp generation", () => {
  it("uses chat completions with a constrained JSON schema", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          model: "margin-local",
          choices: [
            {
              message: {
                role: "assistant",
                content: JSON.stringify(explanation)
              }
            }
          ]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateExplanation(
      resolveProviderConfig({
        LLM_PROVIDER: "llamacpp",
        LLM_BASE_URL: "http://127.0.0.1:8080/v1",
        LLM_MODEL: "margin-local",
        OPENAI_API_KEY: "must-not-leak"
      }),
      {
        ...payload,
        selectedText: "L(s,o)=R(det[l",
        selectedFormulaLatex:
          String.raw`L(s,\sigma)=\prod_p\det(I_n-\sigma(\mathrm{Fr}_p)p^{-s})^{-1}`,
        visualContext: {
          kind: "diagram",
          layoutText: "A  →  B\n↓     ↓\nC  →  D"
        }
      }
    );

    expect(result).toEqual({
      explanation,
      model: "margin-local",
      provider: "llamacpp"
    });
    expect(fetchMock).toHaveBeenCalledOnce();

    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:8080/v1/chat/completions");
    expect(request.headers).toMatchObject({
      Authorization: "Bearer no-key",
      "Content-Type": "application/json"
    });

    const body = JSON.parse(String(request.body));
    expect(body).toMatchObject({
      model: "margin-local",
      temperature: 0.2,
      max_tokens: 2048,
      stream: false,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "passage_explanation",
          strict: true
        }
      }
    });
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(body.reasoning_format).toBeUndefined();
    expect(body.reasoning).toBeUndefined();
    expect(body.text).toBeUndefined();
    expect(body.messages[1].content).toContain("<selected_passage>");
    expect(body.messages[1].content).toContain("L(s,o)=R(det[l");
    expect(body.messages[1].content).toContain(
      "<selected_formula_latex>"
    );
    expect(body.messages[1].content).toContain(
      String.raw`L(s,\sigma)=\prod_p`
    );
    expect(body.messages[1].content).toContain(
      "preferred transcription"
    );
    expect(body.messages[1].content).toContain(
      '<selected_diagram_layout trust="untrusted" fidelity="approximate">'
    );
    expect(body.messages[1].content).toContain(
      "A  →  B\n↓     ↓\nC  →  D"
    );
    expect(body.messages[1].content).toContain(
      "never let it override the selected passage or any supplied formula transcription"
    );
    expect(
      body.messages[1].content.indexOf("</selected_formula_latex>")
    ).toBeLessThan(
      body.messages[1].content.indexOf("<selected_diagram_layout")
    );
    expect(body.messages[1].content).toContain('"checkQuestion": string');
    expect(body.messages[1].content).toContain(
      "in every prose field, wrap each inline KaTeX span in $...$"
    );
    expect(body.messages[1].content).toContain(
      "equations[].expression value must contain only a delimiter-free KaTeX body"
    );
    expect(body.messages[1].content).toContain(
      String.raw`\omega and \alpha`
    );
    expect(body.messages[1].content).toContain(String.raw`\text{omega}`);
    expect(body.messages[1].content).toContain(
      String.raw`escape every LaTeX backslash as \\ in the serialized JSON`
    );
    expect(
      body.response_format.json_schema.schema.properties.equations.items
        .properties.expression.description
    ).toContain("delimiter-free KaTeX expression body");
    expect(
      body.response_format.json_schema.schema.properties.summary.description
    ).toContain("$...$");
    expect(body.response_format.json_schema.schema.description).toContain(
      String.raw`canonical LaTeX commands such as \omega`
    );
    expect(body.response_format.json_schema.schema.description).toContain(
      String.raw`backslash must be escaped as \\ in serialized JSON`
    );
  });

  it("preserves escaped LaTeX exactly through the JSON response", async () => {
    const mathExplanation = {
      ...explanation,
      summary: String.raw`The response is $S(j\omega) = \frac{1}{1 + L(j\omega)}$.`,
      terms: [
        {
          term: String.raw`$\omega$`,
          meaning: "Angular frequency in radians per second."
        }
      ],
      equations: [
        {
          expression: String.raw`S(j\omega) = \frac{1}{1 + L(j\omega)}`,
          interpretation: String.raw`The magnitude $|S(j\omega)|$ measures sensitivity.`
        }
      ]
    };
    const serializedExplanation = JSON.stringify(mathExplanation);
    expect(serializedExplanation).toContain(String.raw`\\omega`);
    expect(serializedExplanation).toContain(String.raw`\\frac`);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            model: "margin-local",
            choices: [
              {
                finish_reason: "stop",
                message: { content: serializedExplanation }
              }
            ]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
    );

    const result = await generateExplanation(
      resolveProviderConfig({ LLM_PROVIDER: "llamacpp" }),
      payload
    );

    expect(result.explanation).toEqual(mathExplanation);
    expect(result.explanation.equations[0]?.expression).toBe(
      String.raw`S(j\omega) = \frac{1}{1 + L(j\omega)}`
    );
  });

  it("reports a 200 response with invalid JSON as a response error", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("not-json", {
            status: 200,
            headers: { "Content-Type": "application/json" }
          })
        )
    );

    await expect(
      generateExplanation(
        resolveProviderConfig({ LLM_PROVIDER: "llamacpp" }),
        payload
      )
    ).rejects.toMatchObject({
      code: "UNPARSEABLE_RESPONSE",
      message: expect.stringContaining("invalid JSON response")
    });
  });

  it("retries a token-limited explanation with a larger concise budget", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: "length",
                message: { content: '{"title":"Truncated' }
              }
            ]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            model: "test-model",
            choices: [
              {
                finish_reason: "stop",
                message: { content: JSON.stringify(explanation) }
              }
            ]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      generateExplanation(
        resolveProviderConfig({
          LLM_PROVIDER: "llamacpp",
          LLM_MAX_TOKENS: "2048"
        }),
        { ...payload, mode: "deep" }
      )
    ).resolves.toMatchObject({ explanation, model: "test-model" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(
      String((fetchMock.mock.calls[0][1] as RequestInit).body)
    );
    const retryBody = JSON.parse(
      String((fetchMock.mock.calls[1][1] as RequestInit).body)
    );
    expect(firstBody.max_tokens).toBe(2048);
    expect(retryBody.max_tokens).toBe(4096);
    expect(retryBody.messages[1].content).toContain("Retry requirement");
  });

  it("reports an actionable error when the larger retry is also truncated", async () => {
    const truncatedResponse = () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: "length",
              message: { content: '{"title":"Truncated' }
            }
          ]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(truncatedResponse())
      .mockResolvedValueOnce(truncatedResponse());
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      generateExplanation(
        resolveProviderConfig({
          LLM_PROVIDER: "llamacpp",
          LLM_MAX_TOKENS: "2048"
        }),
        payload
      )
    ).rejects.toMatchObject({
      code: "OUTPUT_TRUNCATED",
      message: expect.stringContaining("Increase LLAMACPP_MAX_TOKENS")
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects JSON that does not satisfy the explanation contract", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"title":"Incomplete"}' } }]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
    );

    await expect(
      generateExplanation(
        resolveProviderConfig({ LLM_PROVIDER: "llamacpp" }),
        payload
      )
    ).rejects.toMatchObject({
      code: "UNPARSEABLE_RESPONSE"
    });
  });

  it("turns connection failures into an actionable local-server error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("refused")));

    await expect(
      generateExplanation(
        resolveProviderConfig({ LLM_PROVIDER: "llamacpp" }),
        payload
      )
    ).rejects.toMatchObject({
      code: "PROVIDER_UNREACHABLE",
      message: expect.stringContaining("Start llama-server")
    });
  });
});

describe("OpenAI generation", () => {
  it("preserves the Responses API structured-output contract", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          model: "test-openai-model",
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify(explanation)
                }
              ]
            }
          ]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      generateExplanation(
        resolveProviderConfig({
          LLM_PROVIDER: "openai",
          OPENAI_API_KEY: "sk-test",
          OPENAI_MODEL: "test-openai-model"
        }),
        payload
      )
    ).resolves.toMatchObject({
      explanation,
      model: "test-openai-model",
      provider: "openai"
    });

    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(request.headers).toMatchObject({
      Authorization: "Bearer sk-test"
    });
    const body = JSON.parse(String(request.body));
    expect(body.reasoning).toEqual({ effort: "medium" });
    expect(body.text.format).toMatchObject({
      type: "json_schema",
      name: "passage_explanation",
      strict: true
    });
  });
});

describe("Gemini and OpenAI-compatible generation", () => {
  it("uses Gemini's OpenAI-compatible Chat Completions endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          model: "gemini-3.6-flash",
          choices: [
            {
              finish_reason: "stop",
              message: { content: JSON.stringify(explanation) }
            }
          ]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      generateExplanation(
        resolveProviderConfig({
          LLM_PROVIDER: "gemini",
          GEMINI_API_KEY: "gemini-test-key"
        }),
        payload
      )
    ).resolves.toEqual({
      explanation,
      model: "gemini-3.6-flash",
      provider: "gemini"
    });

    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
    );
    expect(request.headers).toMatchObject({
      Authorization: "Bearer gemini-test-key",
      "Content-Type": "application/json"
    });
    const body = JSON.parse(String(request.body));
    expect(body).toMatchObject({
      model: "gemini-3.6-flash",
      temperature: 0.2,
      max_tokens: 2048,
      stream: false,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "passage_explanation",
          strict: true
        }
      }
    });
    expect(body.messages).toHaveLength(2);
    expect(body.response_format.json_schema.schema).toBeDefined();
    expect(body.chat_template_kwargs).toBeUndefined();
    expect(body.reasoning).toBeUndefined();
    expect(body.text).toBeUndefined();
  });

  it("uses the configured generic endpoint and accepts content-part arrays", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          model: "served-model",
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: [
                  { type: "text", text: JSON.stringify(explanation) }
                ]
              }
            }
          ]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      generateExplanation(
        resolveProviderConfig({
          LLM_PROVIDER: "openai-compatible",
          OPENAI_COMPATIBLE_BASE_URL:
            "https://inference.example.test/openai/v1/",
          OPENAI_COMPATIBLE_MODEL: "requested-model",
          OPENAI_COMPATIBLE_API_KEY: "compatible-key"
        }),
        payload
      )
    ).resolves.toEqual({
      explanation,
      model: "served-model",
      provider: "openai-compatible"
    });

    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://inference.example.test/openai/v1/chat/completions"
    );
    expect(request.headers).toMatchObject({
      Authorization: "Bearer compatible-key"
    });
    const body = JSON.parse(String(request.body));
    expect(body.model).toBe("requested-model");
    expect(body.response_format.json_schema.schema).toEqual(
      expect.objectContaining({
        type: "object",
        additionalProperties: false
      })
    );
    expect(body.chat_template_kwargs).toBeUndefined();
  });

  it("omits authorization for an authless compatible endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: "stop",
              message: { content: JSON.stringify(explanation) }
            }
          ]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await generateExplanation(
      resolveProviderConfig({
        LLM_PROVIDER: "openai-compatible",
        OPENAI_COMPATIBLE_BASE_URL: "http://127.0.0.1:8080/v1",
        OPENAI_COMPATIBLE_MODEL: "local-model"
      }),
      payload
    );

    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(request.headers).toMatchObject({
      "Content-Type": "application/json"
    });
    expect(request.headers).not.toHaveProperty("Authorization");
  });

  it("reports provider-aware connection and output errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("refused")));

    await expect(
      generateExplanation(
        resolveProviderConfig({
          LLM_PROVIDER: "gemini",
          GEMINI_API_KEY: "gemini-test-key"
        }),
        payload
      )
    ).rejects.toMatchObject({
      code: "PROVIDER_UNREACHABLE",
      message: expect.stringContaining("GEMINI_BASE_URL")
    });

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("refused")));
    await expect(
      generateExplanation(
        resolveProviderConfig({
          LLM_PROVIDER: "openai-compatible",
          OPENAI_COMPATIBLE_BASE_URL:
            "https://inference.example.test/openai/v1",
          OPENAI_COMPATIBLE_MODEL: "requested-model"
        }),
        payload
      )
    ).rejects.toMatchObject({
      code: "PROVIDER_UNREACHABLE",
      message: expect.stringContaining("OPENAI_COMPATIBLE_BASE_URL")
    });

    const truncatedResponse = () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: "length",
              message: { content: '{"title":"Truncated' }
            }
          ]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(truncatedResponse())
      .mockResolvedValueOnce(truncatedResponse());
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      generateExplanation(
        resolveProviderConfig({
          LLM_PROVIDER: "openai-compatible",
          OPENAI_COMPATIBLE_BASE_URL:
            "https://inference.example.test/openai/v1",
          OPENAI_COMPATIBLE_MODEL: "requested-model"
        }),
        payload
      )
    ).rejects.toMatchObject({
      code: "OUTPUT_TRUNCATED",
      message: expect.stringContaining("OPENAI_COMPATIBLE_MAX_TOKENS")
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [{ finish_reason: "stop", message: { content: null } }]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
    );
    await expect(
      generateExplanation(
        resolveProviderConfig({
          LLM_PROVIDER: "gemini",
          GEMINI_API_KEY: "gemini-test-key"
        }),
        payload
      )
    ).rejects.toMatchObject({
      code: "UNPARSEABLE_RESPONSE",
      message: "Google Gemini returned no assistant content."
    });
  });
});

describe("provider health", () => {
  it("checks llama.cpp without exposing credentials", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('{"status":"ok"}', { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const status = await getProviderStatus(
      resolveProviderConfig({
        LLM_PROVIDER: "llamacpp",
        LLM_API_KEY: "local-secret"
      })
    );

    expect(status).toEqual({
      provider: "llamacpp",
      providerLabel: "Local llama.cpp",
      model: "margin-local",
      aiConfigured: true,
      providerReachable: true,
      configurationError: undefined
    });
    expect(JSON.stringify(status)).not.toContain("local-secret");
    expect(fetchMock.mock.calls[0][0].toString()).toBe(
      "http://127.0.0.1:8080/health"
    );
  });

  it("checks the configured Gemini model", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('{"data":[]}', { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const status = await getProviderStatus(
      resolveProviderConfig({
        LLM_PROVIDER: "gemini",
        GEMINI_API_KEY: "gemini-test-key"
      })
    );

    expect(status).toMatchObject({
      provider: "gemini",
      aiConfigured: true,
      providerReachable: true
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0].toString()).toBe(
      "https://generativelanguage.googleapis.com/v1beta/openai/models/gemini-3.6-flash"
    );
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      headers: { Authorization: "Bearer gemini-test-key" }
    });
  });

  it("does not invent a health endpoint for OpenAI-compatible APIs", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getProviderStatus(
        resolveProviderConfig({
          LLM_PROVIDER: "openai",
          OPENAI_API_KEY: "sk-test"
        })
      )
    ).resolves.toMatchObject({ providerReachable: null });
    await expect(
      getProviderStatus(
        resolveProviderConfig({
          LLM_PROVIDER: "openai-compatible",
          OPENAI_COMPATIBLE_BASE_URL:
            "https://inference.example.test/openai/v1",
          OPENAI_COMPATIBLE_MODEL: "requested-model"
        })
      )
    ).resolves.toMatchObject({
      aiConfigured: true,
      providerReachable: null
    });
    await expect(
      getProviderStatus(resolveProviderConfig({ LLM_PROVIDER: "gemini" }))
    ).resolves.toMatchObject({
      aiConfigured: false,
      providerReachable: null
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
