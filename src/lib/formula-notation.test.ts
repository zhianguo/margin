import { describe, expect, it } from "vitest";
import type { Highlight } from "../types";
import {
  getEffectiveFormulaLatex,
  normalizeFormulaLatex,
  sanitizeFormulaNotation
} from "./formula-notation";

describe("formula notation", () => {
  it("normalizes outer fences and math delimiters", () => {
    expect(
      normalizeFormulaLatex("```latex\n$$\\prod_p p^{-s}$$\n```")
    ).toBe("\\prod_p p^{-s}");
  });

  it("rejects empty, malformed, and oversized notation", () => {
    expect(normalizeFormulaLatex("")).toBeNull();
    expect(normalizeFormulaLatex("\\notARealCommand{")).toBeNull();
    expect(normalizeFormulaLatex("x".repeat(4_097))).toBeNull();
  });

  it("keeps valid fields while removing malformed persisted fields", () => {
    expect(
      sanitizeFormulaNotation({
        recognizedLatex: "\\prod_p p^{-s}",
        correctedLatex: "\\notARealCommand{"
      })
    ).toEqual({ recognizedLatex: "\\prod_p p^{-s}" });
  });

  it("prefers a user correction over machine recognition", () => {
    const highlight = {
      content: {
        kind: "formula" as const,
        notation: {
          recognizedLatex: "L(s,o)",
          correctedLatex: "L(s,\\sigma)"
        }
      }
    } satisfies Pick<Highlight, "content">;
    expect(getEffectiveFormulaLatex(highlight)).toBe("L(s,\\sigma)");
  });
});
