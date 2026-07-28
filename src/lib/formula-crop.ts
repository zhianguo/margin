import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import type { PdfVisualRegion } from "../types";

export const FORMULA_CROP_LIMITS = {
  preferredScale: 5,
  maxWidth: 2_048,
  maxHeight: 768,
  maxPixels: 1_500_000,
  maxBytes: 2 * 1_024 * 1_024
} as const;

const RETRY_SCALE_LIMIT = 0.8;
const RETRY_SIZE_SAFETY = 0.9;
// PDF.js AnnotationMode.DISABLE. Avoid loading the full PDF.js runtime here;
// the caller already owns the PDFPageProxy and Node test environments do not
// provide all canvas geometry globals required by that runtime.
const ANNOTATION_MODE_DISABLE = 0;

interface ViewportSize {
  width: number;
  height: number;
}

export interface FormulaCropPlan {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
  scale: number;
  pixelWidth: number;
  pixelHeight: number;
}

export interface FormulaCropResult {
  blob: Blob;
  width: number;
  height: number;
  scale: number;
  dpi: number;
}

export type PdfVisualCropKind = "formula" | "diagram";

export interface FormulaCropOptions {
  signal?: AbortSignal;
  createCanvas?: () => HTMLCanvasElement;
  kind?: PdfVisualCropKind;
}

export class FormulaCropError extends Error {
  code: "invalid_region" | "encoding_failed" | "image_too_large";

  constructor(
    code: FormulaCropError["code"],
    message: string
  ) {
    super(message);
    this.name = "FormulaCropError";
    this.code = code;
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function abortError(): DOMException {
  return new DOMException("Formula crop rendering was cancelled.", "AbortError");
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function validatedRegion(region: PdfVisualRegion): {
  left: number;
  top: number;
  right: number;
  bottom: number;
} {
  if (
    !Number.isInteger(region.pageNumber) ||
    region.pageNumber < 1 ||
    !Number.isFinite(region.x) ||
    !Number.isFinite(region.y) ||
    !Number.isFinite(region.width) ||
    !Number.isFinite(region.height) ||
    region.width <= 0 ||
    region.height <= 0
  ) {
    throw new FormulaCropError(
      "invalid_region",
      "The selected formula region is invalid."
    );
  }

  const left = clamp(region.x, 0, 1);
  const top = clamp(region.y, 0, 1);
  const right = clamp(region.x + region.width, 0, 1);
  const bottom = clamp(region.y + region.height, 0, 1);
  if (right <= left || bottom <= top) {
    throw new FormulaCropError(
      "invalid_region",
      "The selected formula region is outside the PDF page."
    );
  }

  return { left, top, right, bottom };
}

/**
 * Maps a canvas-normalized formula selection into the scale-1 PDF.js viewport,
 * pads it in source-page units, and chooses a bounded raster scale.
 */
export function calculateFormulaCropPlan(
  region: PdfVisualRegion,
  viewport: ViewportSize,
  maximumScale: number = FORMULA_CROP_LIMITS.preferredScale,
  kind: PdfVisualCropKind = "formula"
): FormulaCropPlan {
  if (
    !Number.isFinite(viewport.width) ||
    !Number.isFinite(viewport.height) ||
    viewport.width <= 0 ||
    viewport.height <= 0 ||
    !Number.isFinite(maximumScale) ||
    maximumScale <= 0
  ) {
    throw new FormulaCropError(
      "invalid_region",
      "The PDF page dimensions are invalid."
    );
  }

  const normalized = validatedRegion(region);
  const selectionLeft = normalized.left * viewport.width;
  const selectionTop = normalized.top * viewport.height;
  const selectionRight = normalized.right * viewport.width;
  const selectionBottom = normalized.bottom * viewport.height;
  const selectionHeight = selectionBottom - selectionTop;
  const horizontalPadding =
    kind === "diagram"
      ? clamp(selectionHeight * 0.12, 3, 8)
      : clamp(selectionHeight * 0.35, 6, 18);
  const verticalPadding =
    kind === "diagram"
      ? clamp(selectionHeight * 0.08, 2, 4)
      : clamp(selectionHeight * 0.25, 4, 12);

  const left = Math.max(0, selectionLeft - horizontalPadding);
  const top = Math.max(0, selectionTop - verticalPadding);
  const right = Math.min(viewport.width, selectionRight + horizontalPadding);
  const bottom = Math.min(
    viewport.height,
    selectionBottom + verticalPadding
  );
  const width = right - left;
  const height = bottom - top;
  if (width <= 0 || height <= 0) {
    throw new FormulaCropError(
      "invalid_region",
      "The selected formula region has no visible area."
    );
  }

  let scale = Math.min(
    FORMULA_CROP_LIMITS.preferredScale,
    maximumScale,
    FORMULA_CROP_LIMITS.maxWidth / width,
    FORMULA_CROP_LIMITS.maxHeight / height,
    Math.sqrt(FORMULA_CROP_LIMITS.maxPixels / (width * height))
  );
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new FormulaCropError(
      "invalid_region",
      "The selected formula cannot be rendered at a valid resolution."
    );
  }

  const dimensionsAtScale = (candidateScale: number) => ({
    width: Math.max(1, Math.ceil(width * candidateScale)),
    height: Math.max(1, Math.ceil(height * candidateScale))
  });
  const withinRasterLimits = (dimensions: {
    width: number;
    height: number;
  }) =>
    dimensions.width <= FORMULA_CROP_LIMITS.maxWidth &&
    dimensions.height <= FORMULA_CROP_LIMITS.maxHeight &&
    dimensions.width * dimensions.height <= FORMULA_CROP_LIMITS.maxPixels;

  let dimensions = dimensionsAtScale(scale);
  if (!withinRasterLimits(dimensions)) {
    // The continuous scale calculation can land exactly on a limit, while
    // ceil-ing both axes adds one pixel. Find the nearest valid scale without
    // clipping either source edge.
    let lowerScale = 0;
    let upperScale = scale;
    for (let attempt = 0; attempt < 48; attempt += 1) {
      const candidateScale = (lowerScale + upperScale) / 2;
      const candidateDimensions = dimensionsAtScale(candidateScale);
      if (withinRasterLimits(candidateDimensions)) {
        lowerScale = candidateScale;
      } else {
        upperScale = candidateScale;
      }
    }
    scale = lowerScale;
    dimensions = dimensionsAtScale(scale);
  }
  const pixelWidth = dimensions.width;
  const pixelHeight = dimensions.height;

  return {
    left,
    top,
    right,
    bottom,
    width,
    height,
    scale,
    pixelWidth,
    pixelHeight
  };
}

function canvasToPngBlob(
  canvas: HTMLCanvasElement,
  signal?: AbortSignal
): Promise<Blob> {
  throwIfAborted(signal);

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", handleAbort);
      callback();
    };
    const handleAbort = () => finish(() => reject(abortError()));

    signal?.addEventListener("abort", handleAbort, { once: true });
    try {
      canvas.toBlob((blob) => {
        finish(() => {
          if (signal?.aborted) {
            reject(abortError());
          } else if (blob) {
            resolve(blob);
          } else {
            reject(
              new FormulaCropError(
                "encoding_failed",
                "The browser could not encode the formula image."
              )
            );
          }
        });
      }, "image/png");
    } catch (error) {
      finish(() => reject(error));
    }
  });
}

async function renderPlan(
  page: PDFPageProxy,
  plan: FormulaCropPlan,
  rotation: number,
  createCanvas: () => HTMLCanvasElement,
  signal?: AbortSignal
): Promise<Blob> {
  throwIfAborted(signal);

  const canvas = createCanvas();
  canvas.width = plan.pixelWidth;
  canvas.height = plan.pixelHeight;
  let renderTask: ReturnType<PDFPageProxy["render"]> | null = null;
  const handleAbort = () => {
    try {
      renderTask?.cancel();
    } catch {
      // Cancellation is best-effort; the aborted result is ignored below.
    }
  };

  try {
    const viewport = page.getViewport({ scale: plan.scale, rotation });
    renderTask = page.render({
      canvas,
      viewport,
      transform: [
        1,
        0,
        0,
        1,
        -plan.left * plan.scale,
        -plan.top * plan.scale
      ],
      background: "#ffffff",
      annotationMode: ANNOTATION_MODE_DISABLE,
      intent: "display"
    });
    signal?.addEventListener("abort", handleAbort, { once: true });
    await renderTask.promise;
    throwIfAborted(signal);
    return await canvasToPngBlob(canvas, signal);
  } catch (error) {
    if (signal?.aborted) throw abortError();
    throw error;
  } finally {
    signal?.removeEventListener("abort", handleAbort);
    canvas.width = 0;
    canvas.height = 0;
  }
}

/**
 * Renders a lossless formula crop directly from a PDF page. The visible reader
 * zoom and the browser device-pixel ratio do not affect the output.
 */
export async function renderFormulaPageCrop(
  page: PDFPageProxy,
  region: PdfVisualRegion,
  options: FormulaCropOptions = {}
): Promise<FormulaCropResult> {
  const { kind = "formula", signal } = options;
  throwIfAborted(signal);
  if (page.pageNumber !== region.pageNumber) {
    throw new FormulaCropError(
      "invalid_region",
      "The formula region does not belong to this PDF page."
    );
  }

  const rotation = page.rotate;
  const baseViewport = page.getViewport({ scale: 1, rotation });
  const createCanvas =
    options.createCanvas ?? (() => document.createElement("canvas"));
  let plan = calculateFormulaCropPlan(
    region,
    baseViewport,
    FORMULA_CROP_LIMITS.preferredScale,
    kind
  );
  let blob = await renderPlan(page, plan, rotation, createCanvas, signal);

  if (blob.size > FORMULA_CROP_LIMITS.maxBytes) {
    throwIfAborted(signal);
    const sizeScale =
      Math.sqrt(FORMULA_CROP_LIMITS.maxBytes / blob.size) *
      RETRY_SIZE_SAFETY;
    const retryScale = plan.scale * Math.min(RETRY_SCALE_LIMIT, sizeScale);
    plan = calculateFormulaCropPlan(region, baseViewport, retryScale, kind);
    blob = await renderPlan(page, plan, rotation, createCanvas, signal);
  }

  if (blob.size > FORMULA_CROP_LIMITS.maxBytes) {
    throw new FormulaCropError(
      "image_too_large",
      "The formula image is larger than the OCR upload limit."
    );
  }

  return {
    blob,
    width: plan.pixelWidth,
    height: plan.pixelHeight,
    scale: plan.scale,
    dpi: plan.scale * 72
  };
}

export async function renderPdfVisualCrop(
  pdfDocument: PDFDocumentProxy,
  visualRegion: PdfVisualRegion,
  signal?: AbortSignal,
  kind: PdfVisualCropKind = "formula"
): Promise<Blob> {
  throwIfAborted(signal);
  const page = await pdfDocument.getPage(visualRegion.pageNumber);
  throwIfAborted(signal);
  const result = await renderFormulaPageCrop(page, visualRegion, {
    signal,
    kind
  });
  return result.blob;
}

// Compatibility export for existing formula-specific callers and tests.
export const renderFormulaCrop = renderPdfVisualCrop;
