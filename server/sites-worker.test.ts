import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_FORMULA_IMAGE_BYTES } from "./formula.js";
import worker from "./sites-worker.js";

const pngImage = Uint8Array.from([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
  0x00,
  0x00,
  0x00,
  0x0d
]);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Sites security headers", () => {
  it("allows PDF.js to read browser-local blob URLs", async () => {
    const assetFetch = vi.fn().mockResolvedValue(
      new Response("<!doctype html><html><body>Margin</body></html>", {
        headers: { "Content-Type": "text/html; charset=utf-8" }
      })
    );

    const response = await worker.fetch(
      new Request("https://margin.example/"),
      { ASSETS: { fetch: assetFetch } }
    );

    expect(response.headers.get("Content-Security-Policy")).toContain(
      "connect-src 'self' blob:"
    );
  });
});

describe("Sites LLM providers", () => {
  it("reports Gemini health from Worker environment bindings", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "gemini-test" }), {
        headers: { "Content-Type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await worker.fetch(
      new Request("https://margin.example/api/health"),
      {
        LLM_PROVIDER: "gemini",
        GEMINI_API_KEY: "gemini-secret",
        GEMINI_MODEL: "gemini-test",
        GEMINI_BASE_URL: "https://gemini.example/v1beta/openai"
      }
    );
    const body = await response.json();

    expect(body).toMatchObject({
      ok: true,
      provider: "gemini",
      providerLabel: "Google Gemini",
      model: "gemini-test",
      aiConfigured: true,
      providerReachable: true
    });
    expect(JSON.stringify(body)).not.toContain("gemini-secret");
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "https://gemini.example/v1beta/openai/models/gemini-test"
    );
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      headers: { Authorization: "Bearer gemini-secret" }
    });
  });

  it("reports compatible provider config without inventing a health endpoint", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await worker.fetch(
      new Request("https://margin.example/api/health"),
      {
        LLM_PROVIDER: "openai-compatible",
        OPENAI_COMPATIBLE_API_KEY: "compatible-secret",
        OPENAI_COMPATIBLE_MODEL: "compatible-test",
        OPENAI_COMPATIBLE_BASE_URL: "https://compatible.example/v1"
      }
    );
    const body = await response.json();

    expect(body).toMatchObject({
      ok: true,
      provider: "openai-compatible",
      providerLabel: "OpenAI-compatible API",
      model: "compatible-test",
      aiConfigured: true,
      providerReachable: null
    });
    expect(JSON.stringify(body)).not.toContain("compatible-secret");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Sites formula recognition", () => {
  it("includes separately hosted formula provider health without exposing credentials", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, model: "pix2tex-v1" }), {
        headers: { "Content-Type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await worker.fetch(
      new Request("https://margin.example/api/health"),
      {
        FORMULA_OCR_BASE_URL: "https://formula.example",
        FORMULA_OCR_API_KEY: "must-not-leak"
      }
    );
    const body = await response.json();

    expect(body).toMatchObject({
      ok: true,
      formulaRecognition: {
        configured: true,
        reachable: true,
        label: "Formula OCR",
        model: "pix2tex-v1"
      }
    });
    expect(JSON.stringify(body)).not.toContain("must-not-leak");
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://formula.example/health"
    );
  });

  it("proxies a validated raw formula image and returns only recognized LaTeX", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          latex: String.raw`L(s,\sigma)=\prod_p p^{-s}`,
          model: "pix2tex-v1"
        }),
        { headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await worker.fetch(
      new Request("https://margin.example/api/formula/recognize", {
        method: "POST",
        headers: {
          "Content-Type": "image/png",
          "CF-Connecting-IP": "198.51.100.10"
        },
        body: pngImage
      }),
      {
        FORMULA_OCR_BASE_URL: "https://formula.example",
        FORMULA_OCR_API_KEY: "formula-secret"
      }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      latex: String.raw`L(s,\sigma)=\prod_p p^{-s}`,
      model: "pix2tex-v1"
    });

    const [url, providerRequest] = fetchMock.mock.calls[0] as [
      string,
      RequestInit
    ];
    expect(url).toBe("https://formula.example/v1/recognize");
    expect(providerRequest).toMatchObject({
      method: "POST",
      redirect: "error"
    });
    expect(providerRequest.headers).toMatchObject({
      Authorization: "Bearer formula-secret",
      "Content-Type": "image/png"
    });
    expect(Array.from(providerRequest.body as Uint8Array)).toEqual(
      Array.from(pngImage)
    );
  });

  it("returns stable errors for unsupported and oversized images", async () => {
    const fetchMock = vi.fn();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    vi.stubGlobal("fetch", fetchMock);
    const environment = {
      FORMULA_OCR_BASE_URL: "https://formula.example"
    };

    const unsupported = await worker.fetch(
      new Request("https://margin.example/api/formula/recognize", {
        method: "POST",
        headers: {
          "Content-Type": "image/svg+xml",
          "CF-Connecting-IP": "198.51.100.11"
        },
        body: "<svg/>"
      }),
      environment
    );
    expect(unsupported.status).toBe(415);
    await expect(unsupported.json()).resolves.toMatchObject({
      code: "UNSUPPORTED_FORMULA_IMAGE"
    });

    const oversized = await worker.fetch(
      new Request("https://margin.example/api/formula/recognize", {
        method: "POST",
        headers: {
          "Content-Type": "image/png",
          "Content-Length": String(MAX_FORMULA_IMAGE_BYTES + 1),
          "CF-Connecting-IP": "198.51.100.12"
        },
        body: pngImage
      }),
      environment
    );
    expect(oversized.status).toBe(413);
    await expect(oversized.json()).resolves.toMatchObject({
      code: "FORMULA_IMAGE_TOO_LARGE"
    });
    expect(fetchMock).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("rate limits the formula endpoint independently", async () => {
    const fetchMock = vi.fn().mockImplementation(
      () =>
        Promise.resolve(
          new Response(JSON.stringify({ latex: "x=1" }), {
            headers: { "Content-Type": "application/json" }
          })
        )
    );
    vi.stubGlobal("fetch", fetchMock);
    const environment = {
      FORMULA_OCR_BASE_URL: "https://formula.example"
    };

    for (let requestNumber = 0; requestNumber < 20; requestNumber += 1) {
      const response = await worker.fetch(
        new Request("https://margin.example/api/formula/recognize", {
          method: "POST",
          headers: {
            "Content-Type": "image/png",
            "CF-Connecting-IP": "198.51.100.13"
          },
          body: pngImage
        }),
        environment
      );
      expect(response.status).toBe(200);
    }

    const limited = await worker.fetch(
      new Request("https://margin.example/api/formula/recognize", {
        method: "POST",
        headers: {
          "Content-Type": "image/png",
          "CF-Connecting-IP": "198.51.100.13"
        },
        body: pngImage
      }),
      environment
    );
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("60");
    await expect(limited.json()).resolves.toMatchObject({
      code: "RATE_LIMITED"
    });
    expect(fetchMock).toHaveBeenCalledTimes(20);
  });

  it("rejects non-POST methods without contacting the provider", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await worker.fetch(
      new Request("https://margin.example/api/formula/recognize"),
      { FORMULA_OCR_BASE_URL: "https://formula.example" }
    );

    expect(response.status).toBe(405);
    await expect(response.json()).resolves.toMatchObject({
      code: "METHOD_NOT_ALLOWED"
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
