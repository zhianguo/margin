import { beforeEach, describe, expect, it } from "vitest";
import {
  createHighlight,
  hasSelectionSourceChanged,
  isDiagramCandidateHighlight,
  isSameHighlightSelection,
  loadHighlights,
  saveHighlights,
  selectionRegionFromPages
} from "./highlights";

const region = {
  pageNumber: 1,
  x: 0.1,
  y: 0.2,
  width: 0.3,
  height: 0.04
};

describe("highlight persistence", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips highlights for one document only", () => {
    const highlight = createHighlight("paper-a", "A selected sentence.", [
      {
        pageNumber: 2,
        rects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.04 }]
      }
    ]);

    saveHighlights("paper-a", [highlight]);

    expect(loadHighlights("paper-a")).toEqual([highlight]);
    expect(loadHighlights("paper-b")).toEqual([]);
  });

  it("migrates legacy formula fields into formula content", () => {
    localStorage.setItem(
      "margin:highlights:paper-a",
      JSON.stringify([
        {
          id: "highlight-1",
          documentId: "paper-a",
          text: "x = 1",
          formulaImage: "data:image/png;base64,AAAA",
          formulaRegion: region,
          formulaNotation: { recognizedLatex: "x=1" },
          pages: [{ pageNumber: 1, rects: [] }],
          color: "amber",
          createdAt: "2026-07-24T00:00:00.000Z"
        }
      ])
    );

    expect(loadHighlights("paper-a")[0].content).toEqual({
      kind: "formula",
      previewImage: "data:image/png;base64,AAAA",
      region,
      notation: { recognizedLatex: "x=1" }
    });
  });

  it("rejects an unsafe persisted preview image", () => {
    localStorage.setItem(
      "margin:highlights:paper-a",
      JSON.stringify([
        {
          id: "highlight-1",
          documentId: "paper-a",
          text: "x = 1",
          content: {
            kind: "formula",
            previewImage: "javascript:alert(1)"
          },
          pages: [],
          color: "amber",
          createdAt: "2026-07-24T00:00:00.000Z"
        }
      ])
    );

    expect(loadHighlights("paper-a")[0].content).toEqual({ kind: "text" });
  });

  it("bounds persisted visual previews without dropping highlight text", () => {
    const highlights = Array.from({ length: 31 }, (_, index) => ({
      ...createHighlight(
        "paper-a",
        `Formula ${index}`,
        [{ pageNumber: 1, rects: [] }],
        {
          kind: "formula" as const,
          previewImage: "data:image/png;base64,AAAA"
        }
      ),
      id: `highlight-${index}`
    }));

    saveHighlights("paper-a", highlights);
    const loaded = loadHighlights("paper-a");

    expect(loaded).toHaveLength(31);
    expect(
      loaded.filter(
        (highlight) =>
          highlight.content.kind !== "text" &&
          Boolean(highlight.content.previewImage)
      )
    ).toHaveLength(30);
    expect(loaded[30].text).toBe("Formula 30");
  });

  it("retains notation and region when the image budget is exhausted", () => {
    const highlights = Array.from({ length: 31 }, (_, index) => ({
      ...createHighlight(
        "paper-a",
        `Formula ${index}`,
        [{ pageNumber: 1, rects: [] }],
        {
          kind: "formula" as const,
          previewImage: "data:image/png;base64,AAAA",
          region,
          notation: { recognizedLatex: `x_${index}` }
        }
      ),
      id: `highlight-${index}`
    }));

    saveHighlights("paper-a", highlights);
    const last = loadHighlights("paper-a")[30];

    expect(last.content).toEqual({
      kind: "formula",
      region,
      notation: { recognizedLatex: "x_30" }
    });
  });

  it("strips malformed visual content without dropping the highlight", () => {
    localStorage.setItem(
      "margin:highlights:paper-a",
      JSON.stringify([
        {
          ...createHighlight("paper-a", "x = 1", [
            { pageNumber: 1, rects: [] }
          ]),
          content: {
            kind: "formula",
            region: { ...region, x: -1 },
            notation: { recognizedLatex: "\\notARealCommand{" }
          }
        }
      ])
    );

    const [loaded] = loadHighlights("paper-a");
    expect(loaded.text).toBe("x = 1");
    expect(loaded.content).toEqual({ kind: "text" });
  });

  it("removes near-duplicate legacy highlight rectangles", () => {
    const saved = {
      ...createHighlight("paper-a", "Q → Qp", [
        {
          pageNumber: 11,
          rects: [
            { x: 0.45, y: 0.24, width: 0.04, height: 0.015 },
            { x: 0.45, y: 0.241, width: 0.04, height: 0.015 },
            { x: 0.45, y: 0.3, width: 0.04, height: 0.015 }
          ]
        }
      ])
    };
    localStorage.setItem(
      "margin:highlights:paper-a",
      JSON.stringify([saved])
    );

    expect(loadHighlights("paper-a")[0].pages[0].rects).toHaveLength(2);
  });

  it("deduplicates only selections at the same location", () => {
    const existing = createHighlight("paper-a", "x = 1", [
      {
        pageNumber: 1,
        rects: [{ x: 0.1, y: 0.2, width: 0.2, height: 0.04 }]
      }
    ]);

    expect(
      isSameHighlightSelection(existing, "x = 1", [
        {
          pageNumber: 1,
          rects: [{ x: 0.11, y: 0.2, width: 0.18, height: 0.04 }]
        }
      ])
    ).toBe(true);
    expect(
      isSameHighlightSelection(existing, "x = 1", [
        {
          pageNumber: 1,
          rects: [{ x: 0.6, y: 0.2, width: 0.2, height: 0.04 }]
        }
      ])
    ).toBe(false);
  });

  it("invalidates visual results when a crop grows or kind changes", () => {
    const existing = createHighlight(
      "paper-a",
      "x = 1",
      [
        {
          pageNumber: 1,
          rects: [{ x: 0.1, y: 0.2, width: 0.2, height: 0.04 }]
        }
      ],
      {
        kind: "formula",
        previewImage: "data:image/png;base64,AAAA",
        region: { ...region, width: 0.2 }
      }
    );

    expect(
      hasSelectionSourceChanged(
        existing,
        [
          {
            pageNumber: 1,
            rects: [{ x: 0.08, y: 0.18, width: 0.5, height: 0.1 }]
          }
        ],
        {
          kind: "formula",
          previewImage: "data:image/png;base64,BBBB",
          region: {
            pageNumber: 1,
            x: 0.08,
            y: 0.18,
            width: 0.5,
            height: 0.1
          }
        }
      )
    ).toBe(true);
    expect(
      hasSelectionSourceChanged(existing, existing.pages, {
        kind: "diagram",
        region: { ...region, width: 0.2 }
      })
    ).toBe(true);
  });

  it("keeps notation for a geometrically identical repeated selection", () => {
    const existing = createHighlight(
      "paper-a",
      "x = 1",
      [
        {
          pageNumber: 1,
          rects: [{ x: 0.1, y: 0.2, width: 0.2, height: 0.04 }]
        }
      ],
      {
        kind: "formula",
        previewImage: "data:image/png;base64,AAAA",
        region: { ...region, width: 0.2 },
        notation: { recognizedLatex: "x=1" }
      }
    );

    expect(
      hasSelectionSourceChanged(
        existing,
        [
          {
            pageNumber: 1,
            rects: [
              { x: 0.1005, y: 0.2, width: 0.1995, height: 0.04 }
            ]
          }
        ],
        {
          kind: "formula",
          region: {
            pageNumber: 1,
            x: 0.1005,
            y: 0.2,
            width: 0.1995,
            height: 0.04
          }
        }
      )
    ).toBe(false);
  });

  it("derives a visual region and identifies a legacy diagram candidate", () => {
    const highlight = createHighlight(
      "paper-a",
      "Q −−−−→ Qp x \uF8E6 \uF8E6 x \uF8E6 \uF8E6 Q −−−−→ Qp",
      [
        {
          pageNumber: 11,
          rects: [
            { x: 0.45, y: 0.24, width: 0.04, height: 0.015 },
            { x: 0.52, y: 0.24, width: 0.04, height: 0.015 },
            { x: 0.45, y: 0.27, width: 0.01, height: 0.015 },
            { x: 0.52, y: 0.27, width: 0.01, height: 0.015 },
            { x: 0.45, y: 0.3, width: 0.04, height: 0.015 },
            { x: 0.52, y: 0.3, width: 0.04, height: 0.015 }
          ]
        }
      ]
    );

    expect(isDiagramCandidateHighlight(highlight)).toBe(true);
    const visualRegion = selectionRegionFromPages(highlight.pages);
    expect(visualRegion).toMatchObject({
      pageNumber: 11,
      x: 0.45,
      y: 0.24
    });
    expect(visualRegion?.width).toBeCloseTo(0.11);
    expect(visualRegion?.height).toBeCloseTo(0.075);
  });

  it("ignores malformed persisted values", () => {
    localStorage.setItem(
      "margin:highlights:paper-a",
      JSON.stringify([{ id: "broken" }, null, "not-a-highlight"])
    );

    expect(loadHighlights("paper-a")).toEqual([]);
  });
});
