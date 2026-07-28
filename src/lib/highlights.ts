import type {
  Highlight,
  HighlightContent,
  HighlightPage,
  NormalizedRect,
  PdfVisualRegion
} from "../types";
import { sanitizeFormulaNotation } from "./formula-notation";

const STORAGE_PREFIX = "margin:highlights:";
const MAX_HIGHLIGHTS = 300;
const MAX_PREVIEW_IMAGE_LENGTH = 80_000;
const MAX_PERSISTED_PREVIEW_IMAGES = 30;
const MAX_PERSISTED_IMAGE_CHARACTERS = 1_500_000;

type LegacyHighlight = Partial<Omit<Highlight, "content">> & {
  formulaImage?: unknown;
  formulaRegion?: unknown;
  formulaNotation?: unknown;
  content?: unknown;
};

function isPreviewImage(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_PREVIEW_IMAGE_LENGTH &&
    /^data:image\/(?:png|webp|jpeg);base64,/i.test(value)
  );
}

function sanitizeVisualRegion(value: unknown): PdfVisualRegion | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<PdfVisualRegion>;
  const values = [
    candidate.x,
    candidate.y,
    candidate.width,
    candidate.height
  ];
  if (
    !Number.isInteger(candidate.pageNumber) ||
    Number(candidate.pageNumber) <= 0 ||
    values.some((entry) => !Number.isFinite(entry)) ||
    Number(candidate.x) < 0 ||
    Number(candidate.y) < 0 ||
    Number(candidate.width) <= 0 ||
    Number(candidate.height) <= 0 ||
    Number(candidate.x) + Number(candidate.width) > 1.001 ||
    Number(candidate.y) + Number(candidate.height) > 1.001
  ) {
    return undefined;
  }
  return {
    pageNumber: Number(candidate.pageNumber),
    x: Number(candidate.x),
    y: Number(candidate.y),
    width: Number(candidate.width),
    height: Number(candidate.height)
  };
}

function sanitizeNormalizedRect(value: unknown): NormalizedRect | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<NormalizedRect>;
  if (
    !Number.isFinite(candidate.x) ||
    !Number.isFinite(candidate.y) ||
    !Number.isFinite(candidate.width) ||
    !Number.isFinite(candidate.height) ||
    Number(candidate.x) < 0 ||
    Number(candidate.y) < 0 ||
    Number(candidate.width) <= 0 ||
    Number(candidate.height) <= 0 ||
    Number(candidate.x) + Number(candidate.width) > 1.001 ||
    Number(candidate.y) + Number(candidate.height) > 1.001
  ) {
    return null;
  }
  return {
    x: Number(candidate.x),
    y: Number(candidate.y),
    width: Number(candidate.width),
    height: Number(candidate.height)
  };
}

function smallerRectCoverage(
  left: NormalizedRect,
  right: NormalizedRect
): number {
  const intersectionWidth = Math.max(
    0,
    Math.min(left.x + left.width, right.x + right.width) -
      Math.max(left.x, right.x)
  );
  const intersectionHeight = Math.max(
    0,
    Math.min(left.y + left.height, right.y + right.height) -
      Math.max(left.y, right.y)
  );
  const smallerArea = Math.min(
    left.width * left.height,
    right.width * right.height
  );
  return smallerArea > 0
    ? (intersectionWidth * intersectionHeight) / smallerArea
    : 0;
}

function rectArea(rect: NormalizedRect): number {
  return rect.width * rect.height;
}

/**
 * Firefox can expose the same PDF glyph rectangle twice with a sub-pixel
 * vertical offset. Collapse only near-equal pairs; contained scripts and
 * genuinely distinct overlapping glyphs must remain separate highlights.
 */
export function deduplicateNormalizedRects(
  rects: NormalizedRect[]
): NormalizedRect[] {
  const deduplicated: NormalizedRect[] = [];

  for (const rect of rects) {
    const duplicateIndex = deduplicated.findIndex((candidate) => {
      const largerArea = Math.max(rectArea(rect), rectArea(candidate));
      const smallerArea = Math.min(rectArea(rect), rectArea(candidate));
      if (smallerArea <= 0 || smallerArea / largerArea < 0.78) return false;
      return smallerRectCoverage(rect, candidate) >= 0.8;
    });
    if (duplicateIndex < 0) {
      deduplicated.push(rect);
      continue;
    }

    const candidate = deduplicated[duplicateIndex];
    const left = Math.min(candidate.x, rect.x);
    const top = Math.min(candidate.y, rect.y);
    const right = Math.max(
      candidate.x + candidate.width,
      rect.x + rect.width
    );
    const bottom = Math.max(
      candidate.y + candidate.height,
      rect.y + rect.height
    );
    deduplicated[duplicateIndex] = {
      x: left,
      y: top,
      width: right - left,
      height: bottom - top
    };
  }

  return deduplicated;
}

function sanitizePages(value: unknown): HighlightPage[] | null {
  if (!Array.isArray(value)) return null;
  const pages: HighlightPage[] = [];
  for (const rawPage of value) {
    if (!rawPage || typeof rawPage !== "object") return null;
    const candidate = rawPage as Partial<HighlightPage>;
    if (
      !Number.isInteger(candidate.pageNumber) ||
      Number(candidate.pageNumber) <= 0 ||
      !Array.isArray(candidate.rects)
    ) {
      return null;
    }
    const rects = candidate.rects
      .map(sanitizeNormalizedRect)
      .filter((rect): rect is NormalizedRect => Boolean(rect));
    pages.push({
      pageNumber: Number(candidate.pageNumber),
      rects: deduplicateNormalizedRects(rects)
    });
  }
  return pages;
}

function sanitizeContent(
  value: unknown,
  legacy: LegacyHighlight
): HighlightContent {
  if (value && typeof value === "object") {
    const candidate = value as Record<string, unknown>;
    if (candidate.kind === "text") return { kind: "text" };

    const previewImage = isPreviewImage(candidate.previewImage)
      ? candidate.previewImage
      : undefined;
    const region = sanitizeVisualRegion(candidate.region);
    if (candidate.kind === "formula") {
      const notation = sanitizeFormulaNotation(candidate.notation);
      if (previewImage || region || notation) {
        return {
          kind: "formula",
          ...(region ? { region } : {}),
          ...(previewImage ? { previewImage } : {}),
          ...(notation ? { notation } : {})
        };
      }
    }
    if (candidate.kind === "diagram" && region) {
      const layoutText =
        typeof candidate.layoutText === "string"
          ? candidate.layoutText.trim().slice(0, 8_000)
          : "";
      return {
        kind: "diagram",
        region,
        ...(previewImage ? { previewImage } : {}),
        ...(layoutText ? { layoutText } : {})
      };
    }
  }

  const previewImage = isPreviewImage(legacy.formulaImage)
    ? legacy.formulaImage
    : undefined;
  const region = sanitizeVisualRegion(legacy.formulaRegion);
  const notation = sanitizeFormulaNotation(legacy.formulaNotation);
  if (previewImage || region || notation) {
    return {
      kind: "formula",
      ...(region ? { region } : {}),
      ...(previewImage ? { previewImage } : {}),
      ...(notation ? { notation } : {})
    };
  }
  return { kind: "text" };
}

function parseHighlight(value: unknown, documentId: string): Highlight | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as LegacyHighlight;
  const pages = sanitizePages(candidate.pages);
  if (
    typeof candidate.id !== "string" ||
    candidate.documentId !== documentId ||
    typeof candidate.text !== "string" ||
    !pages ||
    typeof candidate.createdAt !== "string"
  ) {
    return null;
  }

  return {
    id: candidate.id,
    documentId,
    text: candidate.text.slice(0, 8_000),
    content: sanitizeContent(candidate.content, candidate),
    pages,
    color:
      candidate.color === "sage" || candidate.color === "rose"
        ? candidate.color
        : "amber",
    createdAt: candidate.createdAt
  };
}

export function loadHighlights(documentId: string): Highlight[] {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${documentId}`);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => parseHighlight(item, documentId))
      .filter((item): item is Highlight => Boolean(item))
      .slice(0, MAX_HIGHLIGHTS);
  } catch {
    return [];
  }
}

function withoutPreviewImage(highlight: Highlight): Highlight {
  if (highlight.content.kind === "text" || !highlight.content.previewImage) {
    return highlight;
  }
  const { previewImage: _omittedImage, ...content } = highlight.content;
  return { ...highlight, content };
}

export function saveHighlights(
  documentId: string,
  highlights: Highlight[]
): void {
  const recentHighlights = highlights.slice(0, MAX_HIGHLIGHTS);
  let persistedImageCount = 0;
  let persistedImageCharacters = 0;
  const boundedHighlights = recentHighlights.map((highlight) => {
    const image =
      highlight.content.kind === "text"
        ? undefined
        : highlight.content.previewImage;
    if (!image) return highlight;
    if (
      persistedImageCount < MAX_PERSISTED_PREVIEW_IMAGES &&
      persistedImageCharacters + image.length <=
        MAX_PERSISTED_IMAGE_CHARACTERS
    ) {
      persistedImageCount += 1;
      persistedImageCharacters += image.length;
      return highlight;
    }
    return withoutPreviewImage(highlight);
  });

  try {
    localStorage.setItem(
      `${STORAGE_PREFIX}${documentId}`,
      JSON.stringify(boundedHighlights)
    );
  } catch {
    try {
      localStorage.setItem(
        `${STORAGE_PREFIX}${documentId}`,
        JSON.stringify(recentHighlights.map(withoutPreviewImage))
      );
    } catch {
      // A full or disabled localStorage should not stop reading.
    }
  }
}

export function createHighlight(
  documentId: string,
  text: string,
  pages: Highlight["pages"],
  content: HighlightContent = { kind: "text" }
): Highlight {
  return {
    id: crypto.randomUUID(),
    documentId,
    text,
    content,
    pages,
    color: "amber",
    createdAt: new Date().toISOString()
  };
}

function unionNormalizedRects(rects: NormalizedRect[]): NormalizedRect | null {
  if (rects.length === 0) return null;
  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top
  };
}

export function selectionRegionFromPages(
  pages: HighlightPage[]
): PdfVisualRegion | undefined {
  if (pages.length !== 1) return undefined;
  const bounds = unionNormalizedRects(pages[0].rects);
  return bounds ? { pageNumber: pages[0].pageNumber, ...bounds } : undefined;
}

function sameNormalizedRect(
  left: NormalizedRect,
  right: NormalizedRect,
  tolerance = 0.002
): boolean {
  return (
    Math.abs(left.x - right.x) <= tolerance &&
    Math.abs(left.y - right.y) <= tolerance &&
    Math.abs(left.width - right.width) <= tolerance &&
    Math.abs(left.height - right.height) <= tolerance
  );
}

export function hasSelectionSourceChanged(
  highlight: Highlight,
  pages: HighlightPage[],
  content: HighlightContent
): boolean {
  if (highlight.content.kind !== content.kind) return true;
  if (highlight.content.kind === "text" && content.kind === "text") {
    return false;
  }
  if (highlight.pages.length !== 1 || pages.length !== 1) return true;
  const previousBounds = unionNormalizedRects(highlight.pages[0].rects);
  const nextBounds = unionNormalizedRects(pages[0].rects);
  if (
    highlight.pages[0].pageNumber !== pages[0].pageNumber ||
    !previousBounds ||
    !nextBounds ||
    !sameNormalizedRect(previousBounds, nextBounds)
  ) {
    return true;
  }

  const previousRegion =
    highlight.content.kind === "text" ? undefined : highlight.content.region;
  const nextRegion = content.kind === "text" ? undefined : content.region;
  if (previousRegion && nextRegion) {
    return (
      previousRegion.pageNumber !== nextRegion.pageNumber ||
      !sameNormalizedRect(previousRegion, nextRegion)
    );
  }

  // A repeated selection can temporarily lack a preview/region while its
  // canvas is rendering. Preserve verified notation for unchanged geometry.
  return false;
}

export function isSameHighlightSelection(
  highlight: Highlight,
  text: string,
  pages: HighlightPage[]
): boolean {
  if (highlight.text !== text || pages.length !== 1) return false;
  const selectedPage = pages[0];
  const existingPage = highlight.pages.find(
    (page) => page.pageNumber === selectedPage.pageNumber
  );
  if (!existingPage || highlight.pages.length !== 1) return false;
  const existingBounds = unionNormalizedRects(existingPage.rects);
  const selectedBounds = unionNormalizedRects(selectedPage.rects);
  return Boolean(
    existingBounds &&
      selectedBounds &&
      smallerRectCoverage(existingBounds, selectedBounds) >= 0.6
  );
}

export function isDiagramCandidateHighlight(highlight: Highlight): boolean {
  if (highlight.content.kind !== "text" || highlight.pages.length !== 1) {
    return false;
  }
  const rects = highlight.pages[0].rects;
  const bounds = unionNormalizedRects(rects);
  if (
    !bounds ||
    rects.length < 4 ||
    bounds.height < 0.015 ||
    bounds.height > 0.35
  ) {
    return false;
  }

  const typicalHeight =
    [...rects]
      .map((rect) => rect.height)
      .sort((left, right) => left - right)[Math.floor(rects.length / 2)] || 0;
  if (typicalHeight <= 0 || bounds.height < typicalHeight * 1.8) return false;

  const rowCenters: number[] = [];
  for (const rect of [...rects].sort((left, right) => left.y - right.y)) {
    const center = rect.y + rect.height / 2;
    if (
      !rowCenters.some(
        (candidate) => Math.abs(candidate - center) <= typicalHeight * 0.55
      )
    ) {
      rowCenters.push(center);
    }
  }

  const mathSignals =
    highlight.text.match(
      /[=≠≈≤≥∑∏∫√∞∈∉⊂⊆∪∩→←↦↑↓^_\uE000-\uF8FF]/gu
    )?.length ?? 0;
  const proseWords =
    highlight.text.match(/\b[A-Za-z]{3,}\b/g)?.length ?? 0;
  return rowCenters.length >= 2 && mathSignals >= 2 && proseWords <= 6;
}
