import katex from "katex";
import type { FormulaNotation, Highlight } from "../types";

export const MAX_FORMULA_LATEX_LENGTH = 4_096;

function stripCodeFence(value: string): string {
  const match = value.match(
    /^```(?:math|latex|tex|katex)?[ \t]*\n?([\s\S]*?)\n?```$/i
  );
  return match ? match[1].trim() : value;
}

function stripOuterMathDelimiter(value: string): string {
  const wrappers: Array<[string, string]> = [
    ["$$", "$$"],
    ["\\[", "\\]"],
    ["\\(", "\\)"],
    ["$", "$"]
  ];

  for (const [opening, closing] of wrappers) {
    if (
      value.length >= opening.length + closing.length &&
      value.startsWith(opening) &&
      value.endsWith(closing)
    ) {
      return value.slice(opening.length, -closing.length).trim();
    }
  }

  return value;
}

export function normalizeFormulaLatex(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let body = stripCodeFence(value.trim());
  let previous = "";
  while (body !== previous) {
    previous = body;
    body = stripOuterMathDelimiter(body.trim());
  }

  if (
    body.length === 0 ||
    body.length > MAX_FORMULA_LATEX_LENGTH ||
    body.includes("\0")
  ) {
    return null;
  }

  try {
    katex.renderToString(body, {
      displayMode: true,
      output: "htmlAndMathml",
      strict: "ignore",
      throwOnError: true,
      trust: false
    });
    return body;
  } catch {
    return null;
  }
}

export function sanitizeFormulaNotation(
  value: unknown
): FormulaNotation | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<FormulaNotation>;
  const recognizedLatex = normalizeFormulaLatex(candidate.recognizedLatex);
  const correctedLatex = normalizeFormulaLatex(candidate.correctedLatex);
  if (!recognizedLatex && !correctedLatex) return undefined;
  return {
    ...(recognizedLatex ? { recognizedLatex } : {}),
    ...(correctedLatex ? { correctedLatex } : {})
  };
}

export function getEffectiveFormulaLatex(
  highlight: Pick<Highlight, "content">
): string | undefined {
  if (highlight.content.kind !== "formula") return undefined;
  return (
    highlight.content.notation?.correctedLatex ??
    highlight.content.notation?.recognizedLatex
  );
}
