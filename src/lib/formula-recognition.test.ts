import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formulaImageDataUrlToBlob,
  requestFormulaRecognition
} from "./formula-recognition";

describe("requestFormulaRecognition", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("posts raw image bytes and returns recognized LaTeX", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          latex: "\\prod_p (1-p^{-s})^{-1}",
          model: "pix2tex-0.1.4"
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);
    const image = new Blob(["png"], { type: "image/png" });

    await expect(requestFormulaRecognition(image)).resolves.toEqual({
      latex: "\\prod_p (1-p^{-s})^{-1}",
      model: "pix2tex-0.1.4"
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/formula/recognize",
      expect.objectContaining({
        method: "POST",
        body: image,
        headers: {
          "Content-Type": "image/png",
          Accept: "application/json"
        }
      })
    );
  });

  it("surfaces stable API errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: "Formula OCR is unavailable.",
            code: "FORMULA_PROVIDER_UNREACHABLE"
          }),
          {
            status: 502,
            headers: { "Content-Type": "application/json" }
          }
        )
      )
    );

    await expect(
      requestFormulaRecognition(new Blob(["png"], { type: "image/png" }))
    ).rejects.toMatchObject({
      message: "Formula OCR is unavailable.",
      code: "FORMULA_PROVIDER_UNREACHABLE"
    });
  });

  it("rejects a successful response without usable notation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ latex: "" }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      )
    );

    await expect(
      requestFormulaRecognition(new Blob(["png"], { type: "image/png" }))
    ).rejects.toMatchObject({
      code: "INVALID_FORMULA_RESPONSE"
    });
  });
});

describe("formulaImageDataUrlToBlob", () => {
  it("decodes a bounded image data URL", async () => {
    const blob = formulaImageDataUrlToBlob(
      "data:image/png;base64,aGVsbG8="
    );
    expect(blob?.type).toBe("image/png");
    await expect(blob?.text()).resolves.toBe("hello");
  });

  it("rejects non-image and malformed data URLs", () => {
    expect(
      formulaImageDataUrlToBlob("data:text/html;base64,PGgxPkJvb208L2gxPg==")
    ).toBeNull();
    expect(
      formulaImageDataUrlToBlob("data:image/png;base64,%%%")
    ).toBeNull();
  });
});
