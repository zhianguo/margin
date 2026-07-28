// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FormulaProviderError,
  getFormulaProviderStatus,
  MAX_FORMULA_IMAGE_BYTES,
  recognizeFormula,
  resolveFormulaProviderConfig,
  validateFormulaImage
} from "./formula.js";

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
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("resolveFormulaProviderConfig", () => {
  it("keeps formula recognition optional", () => {
    expect(resolveFormulaProviderConfig({})).toEqual({
      label: "Formula OCR",
      baseUrl: "",
      apiKey: "",
      timeoutMs: 30_000,
      configured: false,
      configurationError: undefined
    });
  });

  it("normalizes a separately hosted provider without exposing its key", () => {
    expect(
      resolveFormulaProviderConfig({
        FORMULA_OCR_BASE_URL: "http://formula-host:9000/?ignored=1#hash",
        FORMULA_OCR_API_KEY: "formula-secret",
        FORMULA_OCR_TIMEOUT_MS: "45000"
      })
    ).toEqual({
      label: "Formula OCR",
      baseUrl: "http://formula-host:9000",
      apiKey: "formula-secret",
      timeoutMs: 45_000,
      configured: true,
      configurationError: undefined
    });
  });

  it("rejects invalid protocols and clamps timeout bounds", () => {
    const invalid = resolveFormulaProviderConfig({
      FORMULA_OCR_BASE_URL: "file:///tmp/formula",
      FORMULA_OCR_TIMEOUT_MS: "999999"
    });
    expect(invalid).toMatchObject({
      configured: false,
      timeoutMs: 120_000,
      configurationError:
        "FORMULA_OCR_BASE_URL must be a valid http:// or https:// URL."
    });

    expect(
      resolveFormulaProviderConfig({
        FORMULA_OCR_BASE_URL: "https://formula.example",
        FORMULA_OCR_TIMEOUT_MS: "20"
      }).timeoutMs
    ).toBe(1_000);
  });
});

describe("formula image validation", () => {
  it("accepts matching image signatures and ignores MIME parameters", () => {
    expect(
      validateFormulaImage(pngImage, "image/png; charset=binary")
    ).toMatchObject({
      mimeType: "image/png",
      bytes: pngImage
    });
  });

  it("rejects unsupported, empty, mismatched, and oversized images", () => {
    expect(() => validateFormulaImage(pngImage, "image/svg+xml")).toThrowError(
      expect.objectContaining({
        code: "UNSUPPORTED_FORMULA_IMAGE",
        status: 415
      })
    );
    expect(() =>
      validateFormulaImage(new Uint8Array(), "image/png")
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_FORMULA_IMAGE", status: 400 })
    );
    expect(() =>
      validateFormulaImage(pngImage, "image/jpeg")
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_FORMULA_IMAGE", status: 400 })
    );
    expect(() =>
      validateFormulaImage(
        new Uint8Array(MAX_FORMULA_IMAGE_BYTES + 1),
        "image/png"
      )
    ).toThrowError(
      expect.objectContaining({
        code: "FORMULA_IMAGE_TOO_LARGE",
        status: 413
      })
    );
  });
});

describe("formula recognition provider", () => {
  it("forwards raw image bytes to the fixed endpoint and validates output", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          latex: String.raw`\prod_p p^{-s}`,
          model: "pix2tex-v1"
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);
    const config = resolveFormulaProviderConfig({
      FORMULA_OCR_BASE_URL: "https://formula.example",
      FORMULA_OCR_API_KEY: "formula-secret"
    });

    await expect(
      recognizeFormula(config, pngImage, "image/png")
    ).resolves.toEqual({
      latex: String.raw`\prod_p p^{-s}`,
      model: "pix2tex-v1"
    });

    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://formula.example/v1/recognize");
    expect(request).toMatchObject({
      method: "POST",
      redirect: "error"
    });
    expect(request.headers).toMatchObject({
      Accept: "application/json",
      Authorization: "Bearer formula-secret",
      "Content-Type": "image/png"
    });
    expect(Array.from(request.body as Uint8Array)).toEqual(
      Array.from(pngImage)
    );
  });

  it("does not manufacture an authorization header without a key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ latex: "x=1" }), {
        headers: { "Content-Type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await recognizeFormula(
      resolveFormulaProviderConfig({
        FORMULA_OCR_BASE_URL: "http://127.0.0.1:9000"
      }),
      pngImage,
      "image/png"
    );

    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty(
      "Authorization"
    );
  });

  it("reports disabled providers without making a network request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      recognizeFormula(resolveFormulaProviderConfig({}), pngImage, "image/png")
    ).rejects.toMatchObject({
      code: "FORMULA_PROVIDER_NOT_CONFIGURED",
      status: 503
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns stable errors for provider failures and invalid responses", async () => {
    const config = resolveFormulaProviderConfig({
      FORMULA_OCR_BASE_URL: "https://formula.example"
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
    await expect(
      recognizeFormula(config, pngImage, "image/png")
    ).rejects.toMatchObject({
      code: "FORMULA_PROVIDER_REQUEST_FAILED",
      status: 502
    });

    fetchMock.mockResolvedValueOnce(
      new Response('{"latex":"x","unexpected":true}', {
        headers: { "Content-Type": "application/json" }
      })
    );
    await expect(
      recognizeFormula(config, pngImage, "image/png")
    ).rejects.toMatchObject({
      code: "INVALID_FORMULA_RESPONSE",
      status: 502
    });

    fetchMock.mockRejectedValueOnce(new TypeError("connection refused"));
    await expect(
      recognizeFormula(config, pngImage, "image/png")
    ).rejects.toMatchObject({
      code: "FORMULA_PROVIDER_UNREACHABLE",
      status: 502
    });
  });

  it("aborts a provider that exceeds the configured timeout", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_url: string, request: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          request.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true }
          );
        })
    );
    vi.stubGlobal("fetch", fetchMock);
    const recognition = recognizeFormula(
      resolveFormulaProviderConfig({
        FORMULA_OCR_BASE_URL: "https://formula.example",
        FORMULA_OCR_TIMEOUT_MS: "1000"
      }),
      pngImage,
      "image/png"
    );
    const rejection = expect(recognition).rejects.toMatchObject({
      code: "FORMULA_PROVIDER_TIMEOUT",
      status: 504
    });

    await vi.advanceTimersByTimeAsync(1_000);
    await rejection;
  });

  it("reports a timeout when a provider stalls after response headers", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: string, request: RequestInit) =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              request.signal?.addEventListener(
                "abort",
                () =>
                  controller.error(
                    new DOMException("Aborted", "AbortError")
                  ),
                { once: true }
              );
            }
          }),
          { headers: { "Content-Type": "application/json" } }
        )
      )
    );
    vi.stubGlobal("fetch", fetchMock);
    const recognition = recognizeFormula(
      resolveFormulaProviderConfig({
        FORMULA_OCR_BASE_URL: "https://formula.example",
        FORMULA_OCR_TIMEOUT_MS: "1000"
      }),
      pngImage,
      "image/png"
    );
    const rejection = expect(recognition).rejects.toMatchObject({
      code: "FORMULA_PROVIDER_TIMEOUT",
      status: 504
    });

    await vi.advanceTimersByTimeAsync(1_000);
    await rejection;
  });
});

describe("formula provider health", () => {
  it("checks the fixed health endpoint and returns safe model metadata", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, model: "pix2tex-v1" }), {
        headers: { "Content-Type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const status = await getFormulaProviderStatus(
      resolveFormulaProviderConfig({
        FORMULA_OCR_BASE_URL: "http://formula-host:9000",
        FORMULA_OCR_API_KEY: "must-not-leak"
      })
    );

    expect(status).toEqual({
      configured: true,
      reachable: true,
      label: "Formula OCR",
      model: "pix2tex-v1",
      configurationError: undefined
    });
    expect(JSON.stringify(status)).not.toContain("must-not-leak");
    expect(fetchMock.mock.calls[0][0]).toBe(
      "http://formula-host:9000/health"
    );
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: "GET",
      redirect: "error"
    });
  });

  it("does not report malformed success responses as ready", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: false }), {
          headers: { "Content-Type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response("healthy", {
          headers: { "Content-Type": "text/plain" }
        })
      );
    vi.stubGlobal("fetch", fetchMock);
    const config = resolveFormulaProviderConfig({
      FORMULA_OCR_BASE_URL: "http://formula-host:9000"
    });

    await expect(getFormulaProviderStatus(config)).resolves.toMatchObject({
      configured: true,
      reachable: false
    });
    await expect(getFormulaProviderStatus(config)).resolves.toMatchObject({
      configured: true,
      reachable: false
    });
  });

  it("does not call an unconfigured provider", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getFormulaProviderStatus(resolveFormulaProviderConfig({}))
    ).resolves.toEqual({
      configured: false,
      reachable: null,
      label: "Formula OCR",
      configurationError: undefined
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

it("FormulaProviderError retains a stable public shape", () => {
  expect(
    new FormulaProviderError("Formula failed.", "FORMULA_FAILED", 503)
  ).toMatchObject({
    name: "FormulaProviderError",
    message: "Formula failed.",
    code: "FORMULA_FAILED",
    status: 503
  });
});
