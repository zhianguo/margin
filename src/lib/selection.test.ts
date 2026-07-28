import { afterEach, describe, expect, it, vi } from "vitest";
import {
  calculateCanvasCrop,
  capturePdfSelection,
  deduplicateSelectionRects,
  detectDiagramSelection,
  normalizeRect,
  normalizeFormulaRegion,
  repairFormulaSelectionGeometry,
  repairPdfSelectionEndpoints,
  type RectLike
} from "./selection";

const pageRect = {
  left: 100,
  top: 200,
  right: 700,
  bottom: 1000,
  width: 600,
  height: 800
};

describe("normalizeRect", () => {
  it("stores selection geometry as page-relative values", () => {
    expect(
      normalizeRect(
        {
          left: 160,
          top: 280,
          right: 460,
          bottom: 320,
          width: 300,
          height: 40
        },
        pageRect
      )
    ).toEqual({
      x: 0.1,
      y: 0.1,
      width: 0.5,
      height: 0.05
    });
  });

  it("clips a browser range rectangle to the page boundary", () => {
    expect(
      normalizeRect(
        {
          left: 50,
          top: 190,
          right: 220,
          bottom: 240,
          width: 170,
          height: 50
        },
        pageRect
      )
    ).toEqual({
      x: 0,
      y: 0,
      width: 0.2,
      height: 0.05
    });
  });

  it("drops rectangles that do not overlap a page", () => {
    expect(
      normalizeRect(
        {
          left: 10,
          top: 10,
          right: 30,
          bottom: 30,
          width: 20,
          height: 20
        },
        pageRect
      )
    ).toBeNull();
  });
});

function rect(
  left: number,
  top: number,
  right: number,
  bottom: number
): RectLike {
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top
  };
}

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("repairPdfSelectionEndpoints", () => {
  function makeSelectionFixture() {
    const root = document.createElement("div");
    const page = document.createElement("div");
    page.dataset.pdfPage = "5";
    page.getBoundingClientRect = vi.fn(
      () => rect(0, 0, 500, 500) as DOMRect
    );
    const textLayer = document.createElement("div");
    textLayer.className = "textLayer";
    page.append(textLayer);
    root.append(page);
    document.body.append(root);

    const makeSpan = (text: string, bounds: RectLike) => {
      const span = document.createElement("span");
      span.setAttribute("role", "presentation");
      span.textContent = text;
      span.getBoundingClientRect = vi.fn(() => bounds as DOMRect);
      textLayer.append(span);
      return span.firstChild as Text;
    };

    const heading = makeSpan("Earlier heading", rect(20, 40, 150, 60));
    const first = makeSpan("A", rect(100, 100, 118, 120));
    makeSpan("=", rect(125, 100, 135, 120));
    const last = makeSpan("B", rect(142, 100, 160, 120));
    const selection = window.getSelection() as Selection;

    return { first, heading, last, root, selection, textLayer };
  }

  it("snaps a page-wide anchor to the formula glyph beside the pointer", () => {
    const { first, last, root, selection, textLayer } =
      makeSelectionFixture();
    selection.setBaseAndExtent(textLayer, 0, last, last.length);
    expect(selection.toString()).toContain("Earlier heading");
    const setBaseAndExtent = vi.spyOn(selection, "setBaseAndExtent");

    expect(
      repairPdfSelectionEndpoints(
        selection,
        root,
        { x: 99.5, y: 110 },
        { x: 159, y: 110 }
      )
    ).toBe(true);
    expect(setBaseAndExtent).toHaveBeenLastCalledWith(
      first,
      0,
      last,
      last.length
    );
    expect(selection.toString()).toBe("A=B");
  });

  it("leaves already-valid text endpoints unchanged", () => {
    const { first, last, root, selection } = makeSelectionFixture();
    selection.setBaseAndExtent(first, 0, last, last.length);
    const setBaseAndExtent = vi.spyOn(selection, "setBaseAndExtent");

    expect(
      repairPdfSelectionEndpoints(
        selection,
        root,
        { x: 101, y: 110 },
        { x: 159, y: 110 }
      )
    ).toBe(false);
    expect(setBaseAndExtent).not.toHaveBeenCalled();
  });

  it("preserves anchor and focus direction for a reverse drag", () => {
    const { first, last, root, selection, textLayer } =
      makeSelectionFixture();
    selection.setBaseAndExtent(last, last.length, textLayer, 0);
    const setBaseAndExtent = vi.spyOn(selection, "setBaseAndExtent");

    expect(
      repairPdfSelectionEndpoints(
        selection,
        root,
        { x: 159, y: 110 },
        { x: 99.5, y: 110 }
      )
    ).toBe(true);
    expect(setBaseAndExtent).toHaveBeenLastCalledWith(
      last,
      last.length,
      first,
      0
    );
    expect(selection.anchorNode).toBe(last);
    expect(selection.focusNode).toBe(first);
  });

  it("repairs both page-wide endpoints within the same formula row", () => {
    const { first, last, root, selection, textLayer } =
      makeSelectionFixture();
    selection.setBaseAndExtent(
      textLayer,
      0,
      textLayer,
      textLayer.childNodes.length
    );

    expect(
      repairPdfSelectionEndpoints(
        selection,
        root,
        { x: 99.5, y: 110 },
        { x: 161, y: 110 }
      )
    ).toBe(true);
    expect(selection.anchorNode).toBe(first);
    expect(selection.anchorOffset).toBe(0);
    expect(selection.focusNode).toBe(last);
    expect(selection.focusOffset).toBe(last.length);
    expect(selection.toString()).toBe("A=B");
  });

  it("does not snap a horizontally distant container endpoint", () => {
    const { last, root, selection, textLayer } = makeSelectionFixture();
    selection.setBaseAndExtent(textLayer, 0, last, last.length);
    const setBaseAndExtent = vi.spyOn(selection, "setBaseAndExtent");

    expect(
      repairPdfSelectionEndpoints(
        selection,
        root,
        { x: 30, y: 110 },
        { x: 159, y: 110 }
      )
    ).toBe(false);
    expect(setBaseAndExtent).not.toHaveBeenCalled();
  });

  it("does not snap a container endpoint from another visual row", () => {
    const { last, root, selection, textLayer } = makeSelectionFixture();
    selection.setBaseAndExtent(textLayer, 0, last, last.length);
    const setBaseAndExtent = vi.spyOn(selection, "setBaseAndExtent");

    expect(
      repairPdfSelectionEndpoints(
        selection,
        root,
        { x: 99.5, y: 155 },
        { x: 159, y: 110 }
      )
    ).toBe(false);
    expect(setBaseAndExtent).not.toHaveBeenCalled();
  });
});

describe("repairFormulaSelectionGeometry", () => {
  it("adds a visually enclosed formula glyph omitted by DOM selection order", () => {
    const repair = repairFormulaSelectionGeometry(
      "L(s,o) = R(det[ln-o(Ftp)p-*]y'",
      [
        rect(20, 100, 60, 120),
        rect(70, 100, 80, 120),
        rect(110, 100, 240, 120)
      ],
      [
        {
          text: "L(s,o)",
          rect: rect(20, 100, 60, 120),
          selected: true
        },
        { text: "=", rect: rect(70, 100, 80, 120), selected: true },
        {
          text: "R(det[ln-o(Ftp)p-*]y'",
          rect: rect(110, 100, 240, 120),
          selected: true
        },
        // This OCR glyph is visually attached below the operator, but the PDF
        // stores it after the range endpoint.
        { text: "P", rect: rect(90, 124, 100, 136), selected: false },
        // A nearby prose line must not be pulled into the formula.
        { text: "previous", rect: rect(90, 70, 150, 82), selected: false },
        {
          text: "next body line",
          rect: rect(80, 123, 180, 143),
          selected: false
        },
        // A long neighboring span that only grazes the endpoint is outside the
        // user's horizontal selection corridor.
        { text: "outside", rect: rect(235, 100, 400, 120), selected: false }
      ]
    );

    expect(repair?.addedFragments.map((fragment) => fragment.text)).toEqual([
      "P"
    ]);
    expect(repair?.rects).toEqual([
      rect(20, 100, 240, 120),
      rect(90, 124, 100, 136)
    ]);
  });

  it("does not expand an ordinary prose selection", () => {
    expect(
      repairFormulaSelectionGeometry(
        "ordinary prose",
        [rect(20, 100, 180, 120)],
        [
          {
            text: "ordinary ",
            rect: rect(20, 100, 90, 120),
            selected: true
          },
          {
            text: "prose",
            rect: rect(90, 100, 180, 120),
            selected: true
          },
          { text: "note", rect: rect(80, 123, 110, 133), selected: false }
        ]
      )
    ).toBeNull();
  });

  it("does not treat mixed prose containing an equals sign as a formula", () => {
    expect(
      repairFormulaSelectionGeometry(
        "Let x = 1 in this example",
        [rect(20, 100, 220, 120)],
        [
          {
            text: "Let x = 1 in this example",
            rect: rect(20, 100, 220, 120),
            selected: true
          },
          { text: "2", rect: rect(80, 122, 87, 130), selected: false }
        ]
      )
    ).toBeNull();
  });

  it("does not treat prose containing a superscript expression as a formula", () => {
    expect(
      repairFormulaSelectionGeometry(
        "The value x^2 is positive",
        [rect(20, 100, 220, 120)],
        [
          {
            text: "The value x^2 is positive",
            rect: rect(20, 100, 220, 120),
            selected: true
          },
          { text: "2", rect: rect(80, 90, 87, 98), selected: false }
        ]
      )
    ).toBeNull();
  });

  it("leaves multiline selections on the native range path", () => {
    expect(
      repairFormulaSelectionGeometry(
        "x = 1 across two lines",
        [rect(20, 100, 180, 110), rect(20, 114, 160, 124)],
        [
          { text: "x = 1", rect: rect(20, 100, 80, 110), selected: true },
          {
            text: "across two lines",
            rect: rect(20, 114, 160, 124),
            selected: true
          },
          { text: "2", rect: rect(90, 126, 96, 134), selected: false }
        ]
      )
    ).toBeNull();
  });

  it("can recover a script next to one formula span", () => {
    const repair = repairFormulaSelectionGeometry(
      "x =",
      [rect(20, 100, 50, 120)],
      [
        { text: "x =", rect: rect(20, 100, 50, 120), selected: true },
        { text: "2", rect: rect(40, 122, 47, 130), selected: false }
      ]
    );

    expect(repair?.addedFragments.map((fragment) => fragment.text)).toEqual([
      "2"
    ]);
  });

  it("accepts a baseline-attached inverse-limit formula with a qualifier", () => {
    const repair = repairFormulaSelectionGeometry(
      "A = lim←−i∈IAi ={(ai) ∈ ∏i∈IAi : ϕji(aj ) = ai for every pair i ≤ j},",
      [rect(20, 78, 290, 136)],
      [
        { text: "A =", rect: rect(20, 100, 45, 120), selected: true },
        { text: "{", rect: rect(50, 78, 58, 98), selected: true },
        { text: "lim", rect: rect(60, 100, 82, 120), selected: true },
        { text: "∏", rect: rect(85, 78, 105, 98), selected: true },
        { text: "p≤n", rect: rect(85, 124, 110, 136), selected: true },
        {
          text: "A_p → A,",
          rect: rect(115, 100, 180, 120),
          selected: true
        },
        {
          text: " for every pair",
          rect: rect(180, 100, 290, 120),
          selected: true
        },
        { text: "K", rect: rect(70, 124, 78, 136), selected: false },
        {
          text: "next body line",
          rect: rect(170, 130, 280, 150),
          selected: false
        }
      ]
    );

    expect(repair?.addedFragments.map((fragment) => fragment.text)).toEqual([
      "K"
    ]);
  });

  it("accepts a two-signal formula with a short prose qualifier", () => {
    const repair = repairFormulaSelectionGeometry(
      "x_n → x for every n",
      [rect(20, 100, 220, 120)],
      [
        {
          text: "x_n → x for every n",
          rect: rect(20, 100, 220, 120),
          selected: true
        },
        { text: "i", rect: rect(50, 122, 58, 132), selected: false }
      ]
    );

    expect(repair?.addedFragments.map((fragment) => fragment.text)).toEqual([
      "i"
    ]);
  });

  it("rejects two full-sized baselines even when both contain equations", () => {
    expect(
      repairFormulaSelectionGeometry(
        "x = 1 y = 2",
        [rect(20, 100, 120, 120), rect(20, 130, 120, 150)],
        [
          { text: "x = 1", rect: rect(20, 100, 120, 120), selected: true },
          { text: "y = 2", rect: rect(20, 130, 120, 150), selected: true },
          { text: "n", rect: rect(80, 152, 88, 162), selected: false }
        ]
      )
    ).toBeNull();
  });

  it("rejects a short second full-sized line below a long formula", () => {
    expect(
      repairFormulaSelectionGeometry(
        "A = lim ∏ Ai note",
        [rect(20, 100, 520, 120), rect(20, 130, 70, 150)],
        [
          {
            text: "A = lim ∏ Ai",
            rect: rect(20, 100, 520, 120),
            selected: true
          },
          { text: "note", rect: rect(20, 130, 70, 150), selected: true },
          { text: "n", rect: rect(80, 152, 88, 162), selected: false }
        ]
      )
    ).toBeNull();
  });
});

describe("detectDiagramSelection", () => {
  const legacyPage11Text =
    "Q −−−−→ Qp x \uF8E6 \uF8E6 x \uF8E6 \uF8E6 Q −−−−→ Qp";

  function legacyPage11Fragments() {
    return [
      { text: "Q", rect: rect(200, 100, 208, 110), selected: true },
      { text: "−", rect: rect(214, 100, 219, 110), selected: true },
      { text: "−", rect: rect(220, 100, 225, 110), selected: true },
      { text: "−", rect: rect(226, 100, 231, 110), selected: true },
      { text: "−", rect: rect(232, 100, 237, 110), selected: true },
      { text: "→", rect: rect(238, 100, 248, 110), selected: true },
      { text: "Q", rect: rect(260, 100, 268, 110), selected: true },
      { text: "p", rect: rect(268, 104, 273, 111), selected: true },
      { text: "x", rect: rect(201, 114, 207, 120), selected: true },
      { text: "x", rect: rect(261, 114, 267, 120), selected: true },
      { text: "\uF8E6", rect: rect(202, 122, 206, 131), selected: true },
      { text: "\uF8E6", rect: rect(262, 122, 266, 131), selected: true },
      { text: "\uF8E6", rect: rect(202, 130, 206, 139), selected: true },
      { text: "\uF8E6", rect: rect(262, 130, 266, 139), selected: true },
      { text: "Q", rect: rect(200, 145, 208, 155), selected: true },
      { text: "−", rect: rect(214, 145, 219, 155), selected: true },
      { text: "−", rect: rect(220, 145, 225, 155), selected: true },
      { text: "−", rect: rect(226, 145, 231, 155), selected: true },
      { text: "−", rect: rect(232, 145, 237, 155), selected: true },
      { text: "→", rect: rect(238, 145, 248, 155), selected: true },
      { text: "Q", rect: rect(260, 145, 268, 155), selected: true },
      { text: "p", rect: rect(268, 149, 273, 156), selected: true }
    ];
  }

  it("recognizes the exact corrupt text-layer pattern from the page 11 Artin diagram", () => {
    const candidate = detectDiagramSelection(
      legacyPage11Text,
      legacyPage11Fragments()
    );

    expect(candidate?.layoutText).toBe(
      [
        "Q −−−−→  Qp",
        "↑          ↑",
        "│          │",
        "│          │",
        "Q −−−−→  Qp"
      ].join("\n")
    );
    expect(candidate?.rects).toHaveLength(22);
  });

  it("isolates the diagram when browser selection also intersects adjacent prose", () => {
    const candidate = detectDiagramSelection(
      `the preceding paragraph has many words ${legacyPage11Text} one can identify the representation below`,
      [
        {
          text: "the preceding paragraph has many words",
          rect: rect(30, 75, 185, 90),
          selected: true
        },
        ...legacyPage11Fragments(),
        {
          text: "one can identify the representation below",
          rect: rect(30, 166, 220, 181),
          selected: true
        }
      ]
    );

    expect(candidate).not.toBeNull();
    expect(candidate?.selectedFragments.map((fragment) => fragment.text)).not
      .toContain("the preceding paragraph has many words");
    expect(candidate?.selectedFragments.map((fragment) => fragment.text)).not
      .toContain("one can identify the representation below");
    expect(Math.min(...(candidate?.rects.map((bounds) => bounds.top) ?? [])))
      .toBe(100);
    expect(Math.max(...(candidate?.rects.map((bounds) => bounds.bottom) ?? [])))
      .toBe(156);
  });

  it("isolates the diagram from segmented neighboring math on the real PDF.js page", () => {
    const candidate = detectDiagramSelection(
      "p σp : Q ↪→ Qp From the diagram Q −−−−→ Qp x \uF8E6 \uF8E6 x \uF8E6 \uF8E6 Q −−−−→ Qp one can identify Gp = Gal(Qp/Qp) to a closed subgroup of GQ",
      [
        { text: "p", rect: rect(208, 75, 213, 85), selected: true },
        { text: "σ", rect: rect(284, 75, 290, 85), selected: true },
        { text: "p", rect: rect(290, 78, 294, 85), selected: true },
        { text: ":", rect: rect(300, 75, 303, 85), selected: true },
        { text: "Q", rect: rect(308, 75, 316, 85), selected: true },
        { text: "↪", rect: rect(320, 75, 323, 85), selected: true },
        { text: "→", rect: rect(321, 75, 331, 85), selected: true },
        { text: "Q", rect: rect(336, 75, 344, 85), selected: true },
        { text: "p", rect: rect(344, 78, 348, 85), selected: true },
        {
          text: ". From the",
          rect: rect(349, 75, 397, 85),
          selected: true
        },
        { text: "diagram", rect: rect(63, 88, 98, 98), selected: true },
        ...legacyPage11Fragments(),
        {
          text: "one can identify",
          rect: rect(63, 166, 134, 176),
          selected: true
        },
        { text: "G", rect: rect(138, 166, 146, 176), selected: true },
        { text: "p", rect: rect(146, 169, 150, 176), selected: true },
        { text: "= Gal(", rect: rect(155, 166, 187, 176), selected: true },
        { text: "Q", rect: rect(187, 166, 195, 176), selected: true },
        { text: "p", rect: rect(194, 169, 198, 176), selected: true },
        { text: "/", rect: rect(199, 166, 204, 176), selected: true },
        { text: "Q", rect: rect(204, 166, 212, 176), selected: true },
        { text: "p", rect: rect(212, 169, 216, 176), selected: true },
        {
          text: ") to a closed subgroup of",
          rect: rect(216, 166, 329, 176),
          selected: true
        },
        { text: "G", rect: rect(334, 166, 342, 176), selected: true },
        { text: "Q", rect: rect(342, 169, 347, 176), selected: true },
        {
          text: ", called the",
          rect: rect(348, 166, 398, 176),
          selected: true
        }
      ]
    );

    expect(candidate?.selectedFragments).toHaveLength(22);
    expect(candidate?.layoutText).toBe(
      [
        "Q −−−−→  Qp",
        "↑          ↑",
        "│          │",
        "│          │",
        "Q −−−−→  Qp"
      ].join("\n")
    );
    expect(Math.min(...(candidate?.rects.map((bounds) => bounds.top) ?? [])))
      .toBe(100);
    expect(Math.max(...(candidate?.rects.map((bounds) => bounds.bottom) ?? [])))
      .toBe(156);
  });

  it("does not reclassify two aligned equation lines as a diagram", () => {
    expect(
      detectDiagramSelection("x = 1 y = 2", [
        { text: "x", rect: rect(20, 100, 30, 110), selected: true },
        { text: "=", rect: rect(50, 100, 60, 110), selected: true },
        { text: "1", rect: rect(80, 100, 90, 110), selected: true },
        { text: "y", rect: rect(20, 145, 30, 155), selected: true },
        { text: "=", rect: rect(50, 145, 60, 155), selected: true },
        { text: "2", rect: rect(80, 145, 90, 155), selected: true }
      ])
    ).toBeNull();
  });

  it("does not reclassify a single-line formula with scripts", () => {
    expect(
      detectDiagramSelection("A = lim ∏ A_p → A", [
        { text: "A =", rect: rect(20, 100, 45, 120), selected: true },
        { text: "{", rect: rect(50, 78, 58, 98), selected: true },
        { text: "lim", rect: rect(60, 100, 82, 120), selected: true },
        { text: "∏", rect: rect(85, 78, 105, 98), selected: true },
        { text: "p≤n", rect: rect(85, 124, 110, 136), selected: true },
        {
          text: "A_p → A",
          rect: rect(115, 100, 180, 120),
          selected: true
        }
      ])
    ).toBeNull();
  });
});

describe("deduplicateSelectionRects", () => {
  it("collapses fractional duplicate range boxes but preserves contained scripts", () => {
    expect(
      deduplicateSelectionRects([
        rect(20, 100, 120, 120),
        rect(20.2, 100.1, 120.2, 120.1),
        rect(80, 112, 88, 122)
      ])
    ).toEqual([
      rect(20, 100, 120.2, 120.1),
      rect(80, 112, 88, 122)
    ]);
  });
});

describe("calculateCanvasCrop", () => {
  it("maps viewport geometry through the canvas CSS box and backing scale", () => {
    expect(
      calculateCanvasCrop(
        [rect(161, 281, 461, 321)],
        rect(101, 201, 701, 1001),
        1200,
        1600
      )
    ).toEqual({
      sourceLeft: 100,
      sourceTop: 144,
      sourceWidth: 640,
      sourceHeight: 112
    });
  });

  it("clips selection padding at the canvas boundary", () => {
    expect(
      calculateCanvasCrop(
        [rect(98, 198, 130, 220)],
        rect(100, 200, 700, 1000),
        1200,
        1600
      )
    ).toEqual({
      sourceLeft: 0,
      sourceTop: 0,
      sourceWidth: 74,
      sourceHeight: 49
    });
  });

  it("uses tighter padding for a diagram preview", () => {
    expect(
      calculateCanvasCrop(
        [rect(161, 281, 461, 321)],
        rect(101, 201, 701, 1001),
        1200,
        1600,
        "diagram"
      )
    ).toEqual({
      sourceLeft: 110,
      sourceTop: 153,
      sourceWidth: 620,
      sourceHeight: 94
    });
  });
});

describe("normalizeFormulaRegion", () => {
  it("uses the PDF canvas box rather than the surrounding page shell", () => {
    expect(
      normalizeFormulaRegion(
        [rect(20, 100, 240, 136)],
        rect(10, 20, 310, 420),
        5
      )
    ).toEqual({
      pageNumber: 5,
      x: 10 / 300,
      y: 80 / 400,
      width: 220 / 300,
      height: 36 / 400
    });
  });
});

describe("capturePdfSelection", () => {
  it("captures the page 11 diagram component while preserving native selected text", () => {
    const root = document.createElement("div");
    const page = document.createElement("div");
    page.dataset.pdfPage = "11";
    page.getBoundingClientRect = vi.fn(
      () => rect(0, 0, 400, 400) as DOMRect
    );
    const canvas = document.createElement("canvas");
    canvas.className = "react-pdf__Page__canvas";
    canvas.width = 800;
    canvas.height = 800;
    canvas.getBoundingClientRect = vi.fn(
      () => rect(0, 0, 400, 400) as DOMRect
    );
    const textLayer = document.createElement("div");
    textLayer.className = "textLayer";
    page.append(canvas, textLayer);
    root.append(page);
    document.body.append(root);

    const fragmentData = [
      {
        text: "the preceding paragraph has many words",
        bounds: rect(30, 75, 185, 90)
      },
      { text: "Q", bounds: rect(200, 100, 208, 110) },
      { text: "−", bounds: rect(214, 100, 219, 110) },
      { text: "−", bounds: rect(220, 100, 225, 110) },
      { text: "−", bounds: rect(226, 100, 231, 110) },
      { text: "−", bounds: rect(232, 100, 237, 110) },
      { text: "→", bounds: rect(238, 100, 248, 110) },
      { text: "Q", bounds: rect(260, 100, 268, 110) },
      { text: "p", bounds: rect(268, 104, 273, 111) },
      { text: "x", bounds: rect(201, 114, 207, 120) },
      { text: "x", bounds: rect(261, 114, 267, 120) },
      { text: "\uF8E6", bounds: rect(202, 122, 206, 131) },
      { text: "\uF8E6", bounds: rect(262, 122, 266, 131) },
      { text: "\uF8E6", bounds: rect(202, 130, 206, 139) },
      { text: "\uF8E6", bounds: rect(262, 130, 266, 139) },
      { text: "Q", bounds: rect(200, 145, 208, 155) },
      { text: "−", bounds: rect(214, 145, 219, 155) },
      { text: "−", bounds: rect(220, 145, 225, 155) },
      { text: "−", bounds: rect(226, 145, 231, 155) },
      { text: "−", bounds: rect(232, 145, 237, 155) },
      { text: "→", bounds: rect(238, 145, 248, 155) },
      { text: "Q", bounds: rect(260, 145, 268, 155) },
      { text: "p", bounds: rect(268, 149, 273, 156) },
      {
        text: "one can identify the representation below",
        bounds: rect(30, 166, 220, 181)
      }
    ];
    const spans = fragmentData.map(({ text, bounds }) => {
      const span = document.createElement("span");
      span.setAttribute("role", "presentation");
      span.textContent = text;
      span.getBoundingClientRect = vi.fn(() => bounds as DOMRect);
      textLayer.append(span);
      return span;
    });
    const rangeRects = fragmentData.flatMap(({ bounds }) => [
      bounds,
      rect(
        bounds.left + 0.2,
        bounds.top + 0.1,
        bounds.right + 0.2,
        bounds.bottom + 0.1
      )
    ]);
    const range = {
      commonAncestorContainer: textLayer,
      startContainer: spans[0].firstChild,
      endContainer: spans.at(-1)?.firstChild,
      getClientRects: () => rangeRects,
      intersectsNode: (node: Node) => spans.includes(node as HTMLElement)
    } as unknown as Range;
    const nativeText =
      "the preceding paragraph has many words Q −−−−→ Qp x \uF8E6 \uF8E6 x \uF8E6 \uF8E6 Q −−−−→ Qp one can identify the representation below";
    const selection = {
      rangeCount: 1,
      isCollapsed: false,
      getRangeAt: () => range,
      toString: () => nativeText
    } as unknown as Selection;

    const drawImage = vi.fn();
    vi.spyOn(
      HTMLCanvasElement.prototype,
      "getContext"
    ).mockImplementation(
      () =>
        ({
          drawImage,
          fillRect: vi.fn(),
          fillStyle: "",
          imageSmoothingEnabled: false,
          imageSmoothingQuality: "low"
        }) as unknown as CanvasRenderingContext2D
    );
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
      "data:image/webp;base64,diagram"
    );

    const captured = capturePdfSelection(selection, root);

    expect(captured?.text).toBe(nativeText);
    expect(captured?.content).toEqual({
      kind: "diagram",
      region: {
        pageNumber: 11,
        x: 200 / 400,
        y: 100 / 400,
        width: 73 / 400,
        height: 56 / 400
      },
      previewImage: "data:image/webp;base64,diagram",
      layoutText: [
        "Q −−−−→  Qp",
        "↑          ↑",
        "│          │",
        "│          │",
        "Q −−−−→  Qp"
      ].join("\n")
    });
    expect(captured?.pages[0].rects).toHaveLength(22);
    expect(
      Math.min(...(captured?.pages[0].rects.map((bounds) => bounds.x) ?? []))
    ).toBe(200 / 400);
    expect(
      Math.max(
        ...(captured?.pages[0].rects.map(
          (bounds) => bounds.y + bounds.height
        ) ?? [])
      )
    ).toBe(156 / 400);
    expect(drawImage).toHaveBeenCalledWith(
      canvas,
      386,
      192,
      174,
      128,
      0,
      0,
      174,
      128
    );
  });

  it("persists the recovered formula geometry without rewriting corrupt OCR text", () => {
    const root = document.createElement("div");
    const page = document.createElement("div");
    page.dataset.pdfPage = "5";
    const textLayer = document.createElement("div");
    textLayer.className = "textLayer";
    const canvas = document.createElement("canvas");
    canvas.className = "react-pdf__Page__canvas";
    canvas.width = 0;
    canvas.height = 0;
    canvas.getBoundingClientRect = vi.fn(
      () => rect(10, 20, 310, 420) as DOMRect
    );
    page.append(canvas);
    page.append(textLayer);
    root.append(page);
    document.body.append(root);

    const makeSpan = (text: string, bounds: RectLike) => {
      const span = document.createElement("span");
      span.setAttribute("role", "presentation");
      span.textContent = text;
      span.getBoundingClientRect = vi.fn(() => bounds as DOMRect);
      textLayer.append(span);
      return span;
    };

    const first = makeSpan("L(s,o)", rect(20, 100, 60, 120));
    const equals = makeSpan("=", rect(70, 100, 80, 120));
    const last = makeSpan(
      "R(det[ln-o(Ftp)p-*]y'",
      rect(110, 100, 240, 120)
    );
    makeSpan("P", rect(90, 124, 100, 136));
    makeSpan("next paragraph", rect(20, 150, 180, 170));

    page.getBoundingClientRect = vi.fn(
      () => rect(0, 0, 300, 400) as DOMRect
    );

    const selectedSpans = new Set([first, equals, last]);
    const range = {
      commonAncestorContainer: textLayer,
      startContainer: first.firstChild,
      endContainer: last.firstChild,
      getClientRects: () => [
        rect(20, 100, 60, 120),
        rect(70, 100, 80, 120),
        rect(110, 100, 240, 120)
      ],
      intersectsNode: (node: Node) => selectedSpans.has(node as HTMLElement)
    } as unknown as Range;
    const nativeText = "L(s,o) = R(det[ln-o(Ftp)p-*]y'";
    const selection = {
      rangeCount: 1,
      isCollapsed: false,
      getRangeAt: () => range,
      toString: () => nativeText
    } as unknown as Selection;

    const captured = capturePdfSelection(selection, root);

    expect(captured?.text).toBe(nativeText);
    expect(captured?.pageNumber).toBe(5);
    expect(captured?.geometryRepaired).toBe(true);
    expect(captured?.content).toEqual({
      kind: "formula",
      region: {
        pageNumber: 5,
        x: 10 / 300,
        y: 80 / 400,
        width: 220 / 300,
        height: 36 / 400
      }
    });
    expect(captured?.pages).toEqual([
      {
        pageNumber: 5,
        rects: [
          {
            x: 20 / 300,
            y: 100 / 400,
            width: 220 / 300,
            height: 20 / 400
          },
          {
            x: 90 / 300,
            y: 124 / 400,
            width: 10 / 300,
            height: 12 / 400
          }
        ]
      }
    ]);
    expect(captured?.viewportAnchor).toEqual({
      left: 130,
      top: 100,
      bottom: 136
    });

    root.remove();
  });

  it("captures the full qualified formula from glyph geometry for OCR", () => {
    const root = document.createElement("div");
    const page = document.createElement("div");
    page.dataset.pdfPage = "7";
    page.getBoundingClientRect = vi.fn(
      () => rect(0, 0, 300, 400) as DOMRect
    );
    const textLayer = document.createElement("div");
    textLayer.className = "textLayer";
    const canvas = document.createElement("canvas");
    canvas.className = "react-pdf__Page__canvas";
    canvas.width = 600;
    canvas.height = 800;
    canvas.getBoundingClientRect = vi.fn(
      () => rect(0, 0, 300, 400) as DOMRect
    );
    page.append(canvas, textLayer);
    root.append(page);
    document.body.append(root);

    const makeSpan = (text: string, bounds: RectLike) => {
      const span = document.createElement("span");
      span.setAttribute("role", "presentation");
      span.textContent = text;
      span.getBoundingClientRect = vi.fn(() => bounds as DOMRect);
      textLayer.append(span);
      return span;
    };
    const spans = [
      makeSpan("A =", rect(20, 100, 45, 120)),
      makeSpan("{", rect(50, 78, 58, 98)),
      makeSpan("lim", rect(60, 100, 82, 120)),
      makeSpan("∏", rect(85, 78, 105, 98)),
      makeSpan("p≤n", rect(85, 124, 110, 136)),
      makeSpan("A_p → A,", rect(115, 100, 180, 120)),
      makeSpan(" for every pair", rect(180, 100, 290, 120))
    ];
    const selectedSpans = new Set(spans);
    const range = {
      commonAncestorContainer: textLayer,
      startContainer: spans[0].firstChild,
      endContainer: spans.at(-1)?.firstChild,
      // Firefox can report the container's cross-span box here. Formula
      // geometry must instead come from the selected PDF glyph spans.
      getClientRects: () => [rect(0, 0, 300, 400)],
      intersectsNode: (node: Node) => selectedSpans.has(node as HTMLElement)
    } as unknown as Range;
    const nativeText =
      "A = lim←−i∈IAi ={(ai) ∈ ∏i∈IAi : ϕji(aj ) = ai for every pair i ≤ j},";
    const selection = {
      rangeCount: 1,
      isCollapsed: false,
      getRangeAt: () => range,
      toString: () => nativeText
    } as unknown as Selection;

    const drawImage = vi.fn();
    vi.spyOn(
      HTMLCanvasElement.prototype,
      "getContext"
    ).mockImplementation(
      () =>
        ({
          drawImage,
          fillRect: vi.fn(),
          fillStyle: "",
          imageSmoothingEnabled: false,
          imageSmoothingQuality: "low"
        }) as unknown as CanvasRenderingContext2D
    );
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
      "data:image/webp;base64,formula"
    );

    const captured = capturePdfSelection(selection, root);

    expect(captured?.text).toBe(nativeText);
    expect(captured?.geometryRepaired).toBe(false);
    expect(captured?.content).toEqual({
      kind: "formula",
      previewImage: "data:image/webp;base64,formula",
      region: {
        pageNumber: 7,
        x: 20 / 300,
        y: 78 / 400,
        width: 270 / 300,
        height: 58 / 400
      }
    });
    expect(drawImage).toHaveBeenCalledOnce();
  });

  it("preserves a partial endpoint inside a long formula span", () => {
    const root = document.createElement("div");
    const page = document.createElement("div");
    page.dataset.pdfPage = "9";
    page.getBoundingClientRect = vi.fn(
      () => rect(0, 0, 300, 400) as DOMRect
    );
    const canvas = document.createElement("canvas");
    canvas.className = "react-pdf__Page__canvas";
    canvas.width = 0;
    canvas.height = 0;
    canvas.getBoundingClientRect = vi.fn(
      () => rect(0, 0, 300, 400) as DOMRect
    );
    const textLayer = document.createElement("div");
    textLayer.className = "textLayer";
    const span = document.createElement("span");
    span.setAttribute("role", "presentation");
    span.textContent = "x_n → x for every n";
    span.getBoundingClientRect = vi.fn(
      () => rect(20, 100, 220, 120) as DOMRect
    );
    textLayer.append(span);
    const neighboringScript = document.createElement("span");
    neighboringScript.setAttribute("role", "presentation");
    neighboringScript.textContent = "i";
    neighboringScript.getBoundingClientRect = vi.fn(
      () => rect(200, 122, 208, 132) as DOMRect
    );
    textLayer.append(neighboringScript);
    page.append(canvas, textLayer);
    root.append(page);
    document.body.append(root);

    const range = {
      commonAncestorContainer: span.firstChild,
      startContainer: span.firstChild,
      endContainer: span.firstChild,
      getClientRects: () => [rect(100, 100, 160, 120)],
      intersectsNode: (node: Node) => node === span
    } as unknown as Range;
    const selection = {
      rangeCount: 1,
      isCollapsed: false,
      getRangeAt: () => range,
      toString: () => "x_n → x"
    } as unknown as Selection;

    const captured = capturePdfSelection(selection, root);

    expect(captured?.content).toEqual({
      kind: "formula",
      region: {
        pageNumber: 9,
        x: 100 / 300,
        y: 100 / 400,
        width: 60 / 300,
        height: 20 / 400
      }
    });
    expect(captured?.pages).toEqual([
      {
        pageNumber: 9,
        rects: [
          {
            x: 100 / 300,
            y: 100 / 400,
            width: 60 / 300,
            height: 20 / 400
          }
        ]
      }
    ]);
  });

  it("deduplicates near-identical Range boxes for ordinary text selections", () => {
    const root = document.createElement("div");
    const page = document.createElement("div");
    page.dataset.pdfPage = "3";
    page.getBoundingClientRect = vi.fn(
      () => rect(0, 0, 300, 400) as DOMRect
    );
    const paragraph = document.createElement("p");
    paragraph.textContent = "ordinary prose";
    page.append(paragraph);
    root.append(page);
    document.body.append(root);

    const range = {
      commonAncestorContainer: paragraph,
      startContainer: paragraph.firstChild,
      endContainer: paragraph.firstChild,
      getClientRects: () => [
        rect(20, 100, 120, 120),
        rect(20.2, 100.1, 120.2, 120.1)
      ]
    } as unknown as Range;
    const selection = {
      rangeCount: 1,
      isCollapsed: false,
      getRangeAt: () => range,
      toString: () => "ordinary prose"
    } as unknown as Selection;

    const captured = capturePdfSelection(selection, root);

    expect(captured?.content).toEqual({ kind: "text" });
    expect(captured?.pages[0].pageNumber).toBe(3);
    expect(captured?.pages[0].rects).toHaveLength(1);
    expect(captured?.pages[0].rects[0].x).toBeCloseTo(20 / 300);
    expect(captured?.pages[0].rects[0].y).toBeCloseTo(100 / 400);
    expect(captured?.pages[0].rects[0].width).toBeCloseTo(100.2 / 300);
    expect(captured?.pages[0].rects[0].height).toBeCloseTo(20.1 / 400);
  });
});
