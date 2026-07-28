import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FormulaRegion } from "../types";
import {
  FORMULA_CROP_LIMITS,
  FormulaCropError,
  calculateFormulaCropPlan,
  renderFormulaCrop,
  renderFormulaPageCrop
} from "./formula-crop";

const region: FormulaRegion = {
  pageNumber: 5,
  x: 0.1,
  y: 0.2,
  width: 0.5,
  height: 0.05
};

interface RenderCall {
  width: number;
  height: number;
  viewport: { width: number; height: number; scale: number; rotation: number };
  transform?: number[];
  annotationMode?: number;
  background?: string;
}

function mockPage(options: {
  width?: number;
  height?: number;
  rotation?: number;
  renderPromise?: Promise<void>;
  cancel?: () => void;
} = {}) {
  const width = options.width ?? 600;
  const height = options.height ?? 800;
  const rotation = options.rotation ?? 0;
  const calls: RenderCall[] = [];
  const cancel = vi.fn(options.cancel ?? (() => undefined));
  const getViewport = vi.fn(
    ({ scale, rotation: requestedRotation }: { scale: number; rotation: number }) => ({
      width: width * scale,
      height: height * scale,
      scale,
      rotation: requestedRotation
    })
  );
  const render = vi.fn((parameters: {
    canvas: HTMLCanvasElement;
    viewport: RenderCall["viewport"];
    transform?: number[];
    annotationMode?: number;
    background?: string;
  }) => {
    calls.push({
      width: parameters.canvas.width,
      height: parameters.canvas.height,
      viewport: parameters.viewport,
      transform: parameters.transform,
      annotationMode: parameters.annotationMode,
      background: parameters.background
    });
    return {
      promise: options.renderPromise ?? Promise.resolve(),
      cancel
    };
  });

  return {
    page: {
      pageNumber: 5,
      rotate: rotation,
      getViewport,
      render
    } as unknown as PDFPageProxy,
    calls,
    cancel,
    getViewport,
    render
  };
}

function canvasFactory(blobSizes: number[]) {
  let index = 0;
  return vi.fn(() => {
    const canvas = document.createElement("canvas");
    const size = blobSizes[Math.min(index, blobSizes.length - 1)];
    index += 1;
    Object.defineProperty(canvas, "toBlob", {
      configurable: true,
      value: (callback: BlobCallback) => {
        callback(
          new Blob([new Uint8Array(size)], {
            type: "image/png"
          })
        );
      }
    });
    return canvas;
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("calculateFormulaCropPlan", () => {
  it("maps and pads a canvas-normalized region at the preferred scale", () => {
    expect(calculateFormulaCropPlan(region, { width: 600, height: 800 })).toEqual({
      left: 46,
      top: 150,
      right: 374,
      bottom: 210,
      width: 328,
      height: 60,
      scale: 5,
      pixelWidth: 1640,
      pixelHeight: 300
    });
  });

  it("uses a close crop for diagrams so neighboring prose stays outside", () => {
    const plan = calculateFormulaCropPlan(
      region,
      { width: 600, height: 800 },
      FORMULA_CROP_LIMITS.preferredScale,
      "diagram"
    );

    expect(plan.left).toBeCloseTo(55.2);
    expect(plan.top).toBeCloseTo(156.8);
    expect(plan.right).toBeCloseTo(364.8);
    expect(plan.bottom).toBeCloseTo(203.2);
    expect(plan.width).toBeCloseTo(309.6);
    expect(plan.height).toBeCloseTo(46.4);
  });

  it("clips padding at page edges and respects every raster limit", () => {
    const plan = calculateFormulaCropPlan(
      {
        pageNumber: 1,
        x: -0.1,
        y: -0.1,
        width: 1.2,
        height: 0.6
      },
      { width: 1000, height: 1000 }
    );

    expect(plan.left).toBe(0);
    expect(plan.top).toBe(0);
    expect(plan.right).toBe(1000);
    expect(plan.pixelWidth).toBeLessThanOrEqual(FORMULA_CROP_LIMITS.maxWidth);
    expect(plan.pixelHeight).toBeLessThanOrEqual(
      FORMULA_CROP_LIMITS.maxHeight
    );
    expect(plan.pixelWidth * plan.pixelHeight).toBeLessThanOrEqual(
      FORMULA_CROP_LIMITS.maxPixels
    );
    expect(plan.scale).toBeLessThanOrEqual(
      FORMULA_CROP_LIMITS.preferredScale
    );
  });

  it("compensates for ceil rounding at the total-pixel boundary", () => {
    const plan = calculateFormulaCropPlan(
      { pageNumber: 1, x: 0, y: 0, width: 1, height: 1 },
      { width: 1300, height: 500 }
    );

    expect(plan.pixelWidth * plan.pixelHeight).toBeLessThanOrEqual(
      FORMULA_CROP_LIMITS.maxPixels
    );
    expect(plan.pixelWidth).toBe(1974);
    expect(plan.pixelHeight).toBe(759);
  });

  it("rejects a region that is wholly outside the page", () => {
    expect(() =>
      calculateFormulaCropPlan(
        { pageNumber: 1, x: 1.2, y: 0.2, width: 0.1, height: 0.1 },
        { width: 600, height: 800 }
      )
    ).toThrow(FormulaCropError);
  });
});

describe("renderFormulaPageCrop", () => {
  it("renders the source PDF region without using visible zoom or pixel ratio", async () => {
    const mocked = mockPage({ rotation: 90 });
    const result = await renderFormulaPageCrop(mocked.page, region, {
      createCanvas: canvasFactory([2_000])
    });

    expect(mocked.getViewport).toHaveBeenNthCalledWith(1, {
      scale: 1,
      rotation: 90
    });
    expect(mocked.calls).toHaveLength(1);
    expect(mocked.calls[0]).toMatchObject({
      width: 1640,
      height: 300,
      transform: [1, 0, 0, 1, -230, -750],
      annotationMode: 0,
      background: "#ffffff"
    });
    expect(mocked.calls[0].viewport.scale).toBe(5);
    expect(result).toMatchObject({
      width: 1640,
      height: 300,
      scale: 5,
      dpi: 360
    });
    expect(result.blob.type).toBe("image/png");
  });

  it("re-renders once at a lower scale when the PNG exceeds 2 MiB", async () => {
    const mocked = mockPage();
    const createCanvas = canvasFactory([
      FORMULA_CROP_LIMITS.maxBytes + 1,
      1_024
    ]);

    const result = await renderFormulaPageCrop(mocked.page, region, {
      createCanvas
    });

    expect(mocked.calls).toHaveLength(2);
    expect(mocked.calls[1].viewport.scale).toBeLessThan(
      mocked.calls[0].viewport.scale
    );
    expect(result.blob.size).toBe(1_024);
    expect(result.scale).toBe(mocked.calls[1].viewport.scale);
  });

  it("stops after one lower-scale retry if the PNG remains too large", async () => {
    const mocked = mockPage();
    const createCanvas = canvasFactory([
      FORMULA_CROP_LIMITS.maxBytes + 1,
      FORMULA_CROP_LIMITS.maxBytes + 1
    ]);

    await expect(
      renderFormulaPageCrop(mocked.page, region, { createCanvas })
    ).rejects.toMatchObject({
      name: "FormulaCropError",
      code: "image_too_large"
    });
    expect(mocked.calls).toHaveLength(2);
  });

  it("cancels the PDF.js render task when aborted", async () => {
    let rejectRender: (reason?: unknown) => void = () => undefined;
    const renderPromise = new Promise<void>((_resolve, reject) => {
      rejectRender = reject;
    });
    const mocked = mockPage({
      renderPromise,
      cancel: () => rejectRender(new Error("cancelled"))
    });
    const controller = new AbortController();

    const pending = renderFormulaPageCrop(mocked.page, region, {
      signal: controller.signal,
      createCanvas: canvasFactory([1_024])
    });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(mocked.cancel).toHaveBeenCalledOnce();
  });
});

describe("renderFormulaCrop", () => {
  it("loads the page named by the region and returns its PNG blob", async () => {
    const mocked = mockPage();
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      function toBlob(callback: BlobCallback) {
        callback(new Blob([new Uint8Array(512)], { type: "image/png" }));
      }
    );
    const getPage = vi.fn(async () => mocked.page);
    const pdfDocument = { getPage } as unknown as PDFDocumentProxy;

    const blob = await renderFormulaCrop(pdfDocument, region);

    expect(getPage).toHaveBeenCalledWith(5);
    expect(blob.type).toBe("image/png");
    expect(blob.size).toBe(512);
  });

  it("does not load a page when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const getPage = vi.fn();
    const pdfDocument = { getPage } as unknown as PDFDocumentProxy;

    await expect(
      renderFormulaCrop(pdfDocument, region, controller.signal)
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(getPage).not.toHaveBeenCalled();
  });
});
