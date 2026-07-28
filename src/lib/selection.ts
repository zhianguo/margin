import type {
  CapturedSelection,
  FormulaRegion,
  HighlightContent,
  HighlightPage,
  NormalizedRect
} from "../types";

export interface RectLike {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface FormulaSelectionFragment {
  text: string;
  rect: RectLike;
  selected: boolean;
}

export interface FormulaSelectionRepair {
  addedFragments: FormulaSelectionFragment[];
  rects: RectLike[];
}

export interface CanvasCrop {
  sourceLeft: number;
  sourceTop: number;
  sourceWidth: number;
  sourceHeight: number;
}

type VisualCropKind = "formula" | "diagram";

export interface ViewportPoint {
  x: number;
  y: number;
}

const MAX_FORMULA_IMAGE_LENGTH = 80_000;
const MAX_FORMULA_IMAGE_WIDTH = 900;
const MAX_FORMULA_IMAGE_HEIGHT = 240;

export function normalizeRect(
  rect: RectLike,
  pageRect: RectLike
): NormalizedRect | null {
  const left = Math.max(rect.left, pageRect.left);
  const top = Math.max(rect.top, pageRect.top);
  const right = Math.min(rect.right, pageRect.right);
  const bottom = Math.min(rect.bottom, pageRect.bottom);
  const width = right - left;
  const height = bottom - top;

  if (width < 1 || height < 1 || pageRect.width <= 0 || pageRect.height <= 0) {
    return null;
  }

  return {
    x: (left - pageRect.left) / pageRect.width,
    y: (top - pageRect.top) / pageRect.height,
    width: width / pageRect.width,
    height: height / pageRect.height
  };
}

function elementFromNode(node: Node | null): Element | null {
  if (!node) return null;
  return node.nodeType === Node.ELEMENT_NODE
    ? (node as Element)
    : node.parentElement;
}

function cleanSelectedText(text: string): string {
  return text
    .replace(/-\s*\n\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function rectOverlapsPage(rect: RectLike, pageRect: RectLike): boolean {
  return !(
    rect.right <= pageRect.left ||
    rect.left >= pageRect.right ||
    rect.bottom <= pageRect.top ||
    rect.top >= pageRect.bottom
  );
}

function rectUnion(rects: RectLike[]): RectLike {
  const left = Math.min(...rects.map((rect) => rect.left));
  const top = Math.min(...rects.map((rect) => rect.top));
  const right = Math.max(...rects.map((rect) => rect.right));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));

  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function verticalGap(left: RectLike, right: RectLike): number {
  if (left.bottom < right.top) return right.top - left.bottom;
  if (right.bottom < left.top) return left.top - right.bottom;
  return 0;
}

function horizontalGap(left: RectLike, right: RectLike): number {
  if (left.right < right.left) return right.left - left.right;
  if (right.right < left.left) return left.left - right.right;
  return 0;
}

function intersectionArea(left: RectLike, right: RectLike): number {
  const width =
    Math.min(left.right, right.right) - Math.max(left.left, right.left);
  const height =
    Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top);
  return Math.max(0, width) * Math.max(0, height);
}

function mergeRects(left: RectLike, right: RectLike): RectLike {
  return rectUnion([left, right]);
}

/**
 * Firefox can expose the same PDF text rectangle twice with a fractional-pixel
 * offset. Only collapse near-equal rectangles: a small script contained by a
 * larger glyph is meaningful selection geometry and must remain independent.
 */
export function deduplicateSelectionRects(
  rects: RectLike[]
): RectLike[] {
  const deduplicated: RectLike[] = [];

  for (const rect of rects) {
    const duplicateIndex = deduplicated.findIndex((candidate) => {
      const overlap = intersectionArea(rect, candidate);
      const rectArea = rect.width * rect.height;
      const candidateArea = candidate.width * candidate.height;
      const smallerArea = Math.min(rectArea, candidateArea);
      const largerArea = Math.max(rectArea, candidateArea);
      return (
        smallerArea > 0 &&
        smallerArea / largerArea >= 0.78 &&
        overlap / smallerArea >= 0.8
      );
    });

    if (duplicateIndex >= 0) {
      deduplicated[duplicateIndex] = mergeRects(
        deduplicated[duplicateIndex],
        rect
      );
    } else {
      deduplicated.push(rect);
    }
  }

  return deduplicated;
}

function mergeFormulaLineRects(
  rects: RectLike[],
  medianHeight: number
): RectLike[] {
  const merged = deduplicateSelectionRects(rects);
  const maximumHorizontalGap = Math.max(2, medianHeight * 1.8);

  let changed = true;
  while (changed) {
    changed = false;

    outer: for (let leftIndex = 0; leftIndex < merged.length; leftIndex += 1) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < merged.length;
        rightIndex += 1
      ) {
        const left = merged[leftIndex];
        const right = merged[rightIndex];
        const overlapHeight =
          Math.min(left.bottom, right.bottom) -
          Math.max(left.top, right.top);
        const verticalOverlap =
          overlapHeight / Math.min(left.height, right.height);
        const horizontalGap = Math.max(
          0,
          Math.max(left.left, right.left) - Math.min(left.right, right.right)
        );

        if (
          verticalOverlap >= 0.55 &&
          horizontalGap <= maximumHorizontalGap
        ) {
          merged[leftIndex] = mergeRects(left, right);
          merged.splice(rightIndex, 1);
          changed = true;
          break outer;
        }
      }
    }
  }

  return merged.sort(
    (left, right) => left.top - right.top || left.left - right.left
  );
}

interface FormulaLayout {
  attachedFragmentCount: number;
  selectedFragments: FormulaSelectionFragment[];
}

function rectCenterY(rect: RectLike): number {
  return (rect.top + rect.bottom) / 2;
}

function analyzeFormulaLayout(
  fragments: FormulaSelectionFragment[]
): FormulaLayout | null {
  const selectedFragments = fragments.filter(
    (fragment) =>
      fragment.selected &&
      fragment.text.trim().length > 0 &&
      fragment.rect.width >= 1 &&
      fragment.rect.height >= 1
  );
  if (selectedFragments.length === 0) return null;

  const typicalHeight = median(
    selectedFragments.map((fragment) => fragment.rect.height)
  );
  if (typicalHeight <= 0) return null;

  const bounds = rectUnion(
    selectedFragments.map((fragment) => fragment.rect)
  );
  if (
    bounds.width < typicalHeight * 0.75 ||
    bounds.height > typicalHeight * 3.6
  ) {
    return null;
  }

  const bodyFragments = selectedFragments.filter(
    (fragment) =>
      fragment.rect.height >= typicalHeight * 0.85 &&
      /[\p{L}\p{N}]/u.test(fragment.text)
  );
  if (bodyFragments.length === 0) {
    return {
      attachedFragmentCount: selectedFragments.length,
      selectedFragments
    };
  }

  const baselineTolerance = typicalHeight * 0.45;
  const weightedBody = bodyFragments.map((fragment) => ({
    fragment,
    center: rectCenterY(fragment.rect),
    weight: Math.max(fragment.rect.width, typicalHeight * 0.5)
  }));
  const totalBodyWeight = weightedBody.reduce(
    (total, candidate) => total + candidate.weight,
    0
  );
  const dominantSeed = weightedBody
    .map((seed) => ({
      center: seed.center,
      weight: weightedBody
        .filter(
          (candidate) =>
            Math.abs(candidate.center - seed.center) <= baselineTolerance
        )
        .reduce((total, candidate) => total + candidate.weight, 0)
    }))
    .sort((left, right) => right.weight - left.weight)[0];
  if (
    !dominantSeed ||
    dominantSeed.weight / totalBodyWeight < 0.8
  ) {
    return null;
  }

  const dominantBody = weightedBody
    .filter(
      (candidate) =>
        Math.abs(candidate.center - dominantSeed.center) <= baselineTolerance
    )
    .map((candidate) => candidate.fragment);
  if (dominantBody.length !== bodyFragments.length) return null;

  const dominantWeight = dominantBody.reduce(
    (total, fragment) =>
      total + Math.max(fragment.rect.width, typicalHeight * 0.5),
    0
  );
  const dominantCenter =
    dominantBody.reduce(
      (total, fragment) =>
        total +
        rectCenterY(fragment.rect) *
          Math.max(fragment.rect.width, typicalHeight * 0.5),
      0
    ) / dominantWeight;

  const attached = new Set(dominantBody);
  let remaining = selectedFragments.filter(
    (fragment) => !attached.has(fragment)
  );
  let changed = true;

  while (remaining.length > 0 && changed) {
    changed = false;
    const nextRemaining: FormulaSelectionFragment[] = [];

    for (const fragment of remaining) {
      const closeToBaseline =
        Math.abs(rectCenterY(fragment.rect) - dominantCenter) <=
        typicalHeight * 1.65;
      const horizontallyAttached = Array.from(attached).some(
        (candidate) =>
          horizontalGap(fragment.rect, candidate.rect) <= typicalHeight * 1.8
      );

      if (closeToBaseline && horizontallyAttached) {
        attached.add(fragment);
        changed = true;
      } else {
        nextRemaining.push(fragment);
      }
    }

    remaining = nextRemaining;
  }

  if (remaining.length > 0) return null;

  return {
    attachedFragmentCount: selectedFragments.length - dominantBody.length,
    selectedFragments
  };
}

function countFormulaSignals(text: string): number {
  const symbols =
    text.match(/[=≠≈≤≥∑∏∫√∞∈∉⊂⊆∪∩→←↦^_]/gu)?.length ?? 0;
  const greek = text.match(/\p{Script=Greek}/gu)?.length ?? 0;
  const functions =
    text.match(/\b(?:det|lim|sin|cos|tan|log|exp|max|min|sup|inf)\b/giu)
      ?.length ?? 0;
  return symbols + greek + functions;
}

function proseWords(text: string): string[] {
  return (
    text.match(/\b[A-Za-z]{3,}\b/g)?.filter(
      (word) =>
        !/^(?:det|lim|sin|cos|tan|log|exp|max|min|sup|inf)$/i.test(word) &&
        !/(?:[A-Z].*[A-Z]|[a-z][A-Z])/.test(word)
    ) ?? []
  );
}

function looksFormulaLike(
  text: string,
  layout: FormulaLayout
): boolean {
  const formulaSignals = countFormulaSignals(text);
  const words = proseWords(text);

  if (words.length > 4) return false;
  if (words.length >= 2) return formulaSignals >= 2;
  if (formulaSignals > 0) return true;

  return (
    layout.selectedFragments.length >= 3 &&
    layout.attachedFragmentCount > 0
  );
}

function isSingleLineFormulaSelection(
  nativeText: string,
  rangeRects: RectLike[],
  fragments: FormulaSelectionFragment[]
): boolean {
  const validRangeRects = rangeRects.filter(
    (rect) => rect.width >= 1 && rect.height >= 1
  );
  const selectedFragments = fragments.filter(
    (fragment) =>
      fragment.selected &&
      fragment.rect.width >= 1 &&
      fragment.rect.height >= 1
  );
  if (validRangeRects.length === 0 || selectedFragments.length === 0) {
    return false;
  }

  const layout = analyzeFormulaLayout(selectedFragments);
  if (!layout) return false;

  const signalText =
    nativeText.trim() ||
    selectedFragments.map((fragment) => fragment.text).join("");
  return looksFormulaLike(signalText, layout);
}

interface DiagramRow {
  centerY: number;
  fragments: FormulaSelectionFragment[];
}

export interface DiagramSelectionCandidate {
  selectedFragments: FormulaSelectionFragment[];
  rects: RectLike[];
  layoutText: string;
}

const PRIVATE_USE_GLYPH = /[\uE000-\uF8FF]/u;
const DIAGRAM_CONNECTOR =
  /[=≠≈≤≥→←↦↑↓↕↔⇄⇆⇒⇐⇔+\-−|│\uE000-\uF8FF]/u;

function isObviousProseFragment(text: string): boolean {
  const compact = text.trim();
  if (!compact || countFormulaSignals(compact) > 0) return false;
  if (DIAGRAM_CONNECTOR.test(compact)) return false;
  return proseWords(compact).length > 0;
}

function groupDiagramRows(
  fragments: FormulaSelectionFragment[],
  typicalHeight: number
): DiagramRow[] {
  const tolerance = Math.max(1, typicalHeight * 0.55);
  const rows: DiagramRow[] = [];

  for (const fragment of [...fragments].sort(
    (left, right) =>
      rectCenterY(left.rect) - rectCenterY(right.rect) ||
      left.rect.left - right.rect.left
  )) {
    const centerY = rectCenterY(fragment.rect);
    const row = rows
      .filter((candidate) => Math.abs(candidate.centerY - centerY) <= tolerance)
      .sort(
        (left, right) =>
          Math.abs(left.centerY - centerY) -
          Math.abs(right.centerY - centerY)
      )[0];

    if (!row) {
      rows.push({ centerY, fragments: [fragment] });
      continue;
    }

    row.fragments.push(fragment);
    row.centerY =
      row.fragments.reduce(
        (total, candidate) => total + rectCenterY(candidate.rect),
        0
      ) / row.fragments.length;
  }

  return rows
    .map((row) => ({
      ...row,
      fragments: row.fragments.sort(
        (left, right) => left.rect.left - right.rect.left
      )
    }))
    .sort((left, right) => left.centerY - right.centerY);
}

function diagramBodyAnchors(
  row: DiagramRow,
  typicalHeight: number
): FormulaSelectionFragment[] {
  return row.fragments.filter(
    (fragment) =>
      fragment.rect.height >= typicalHeight * 0.65 &&
      /[\p{L}\p{N}]/u.test(fragment.text) &&
      !PRIVATE_USE_GLYPH.test(fragment.text)
  );
}

function alignedAnchorCount(
  left: DiagramRow,
  right: DiagramRow,
  typicalHeight: number
): number {
  const leftAnchors = diagramBodyAnchors(left, typicalHeight);
  const remainingRight = [...diagramBodyAnchors(right, typicalHeight)];
  let matches = 0;

  for (const leftAnchor of leftAnchors) {
    const leftCenter =
      (leftAnchor.rect.left + leftAnchor.rect.right) / 2;
    const nearestIndex = remainingRight
      .map((rightAnchor, index) => ({
        index,
        distance: Math.abs(
          (rightAnchor.rect.left + rightAnchor.rect.right) / 2 - leftCenter
        )
      }))
      .filter((candidate) => candidate.distance <= typicalHeight * 1.25)
      .sort((first, second) => first.distance - second.distance)[0]?.index;
    if (nearestIndex === undefined) continue;
    remainingRight.splice(nearestIndex, 1);
    matches += 1;
  }

  return matches;
}

function rowHasStrongHorizontalConnector(row: DiagramRow): boolean {
  const text = row.fragments.map((fragment) => fragment.text).join("");
  const connectorCharacters =
    text.match(/[=≠≈≤≥→←↦↔⇄⇆⇒⇐⇔+\-−]/gu)?.length ?? 0;
  return (
    connectorCharacters >= 3 &&
    /[→←↦↔⇄⇆⇒⇐⇔]/u.test(text)
  );
}

function normalizedDiagramGlyph(
  fragment: FormulaSelectionFragment,
  fragments: FormulaSelectionFragment[],
  typicalHeight: number
): string {
  const compact = fragment.text.trim();
  if (!compact) return "";

  if (compact === "x") {
    const centerX = (fragment.rect.left + fragment.rect.right) / 2;
    const hasStemBelow = fragments.some((candidate) => {
      if (!PRIVATE_USE_GLYPH.test(candidate.text)) return false;
      const candidateCenterX =
        (candidate.rect.left + candidate.rect.right) / 2;
      const verticalDistance =
        rectCenterY(candidate.rect) - rectCenterY(fragment.rect);
      return (
        verticalDistance > 0 &&
        verticalDistance <= typicalHeight * 2.8 &&
        Math.abs(candidateCenterX - centerX) <= typicalHeight * 0.75
      );
    });
    if (hasStemBelow) return "↑";
  }

  return compact
    .replace(/\uF8E6/gu, "│")
    .replace(/[\uE000-\uF8FF]/gu, "□");
}

function buildDiagramLayoutText(
  rows: DiagramRow[],
  fragments: FormulaSelectionFragment[],
  typicalHeight: number
): string {
  const bounds = rectUnion(fragments.map((fragment) => fragment.rect));
  const cellWidth = Math.max(1, typicalHeight * 0.55);

  return rows
    .map((row) => {
      let line = "";
      let previousRight = bounds.left;
      let first = true;

      for (const fragment of row.fragments) {
        const glyph = normalizedDiagramGlyph(
          fragment,
          fragments,
          typicalHeight
        );
        if (!glyph) continue;

        const gap = fragment.rect.left - previousRight;
        const spaces = first
          ? Math.max(0, Math.round(gap / cellWidth))
          : gap > typicalHeight * 0.12
            ? Math.max(1, Math.round(gap / cellWidth))
            : 0;
        line += `${" ".repeat(spaces)}${glyph}`;
        previousRight = Math.max(previousRight, fragment.rect.right);
        first = false;
      }

      return line.trimEnd();
    })
    .filter((line) => line.trim().length > 0)
    .join("\n");
}

/**
 * Detect compact, same-page mathematical diagrams from PDF.js glyph geometry.
 * This intentionally requires two aligned node rows plus intervening connector
 * structure. Ordinary multiline equations and prose remain text selections.
 */
export function detectDiagramSelection(
  nativeText: string,
  fragments: FormulaSelectionFragment[]
): DiagramSelectionCandidate | null {
  const selected = fragments.filter(
    (fragment) =>
      fragment.selected &&
      fragment.text.trim().length > 0 &&
      fragment.rect.width >= 1 &&
      fragment.rect.height >= 1
  );
  if (selected.length < 6) return null;

  const diagramFragments = selected.filter(
    (fragment) => !isObviousProseFragment(fragment.text)
  );
  if (diagramFragments.length < 6) return null;

  const typicalHeight = median(
    diagramFragments.map((fragment) => fragment.rect.height)
  );
  if (typicalHeight <= 0) return null;

  const bounds = rectUnion(
    diagramFragments.map((fragment) => fragment.rect)
  );
  if (
    bounds.width < typicalHeight * 2 ||
    bounds.height < typicalHeight * 2 ||
    bounds.height > typicalHeight * 12
  ) {
    return null;
  }

  const rows = groupDiagramRows(diagramFragments, typicalHeight);
  if (rows.length < 3) return null;

  interface PairCandidate {
    topIndex: number;
    bottomIndex: number;
    bounds: RectLike;
    verticalSpan: number;
  }
  const pairCandidates: PairCandidate[] = [];
  for (let topIndex = 0; topIndex < rows.length - 1; topIndex += 1) {
    if (!rowHasStrongHorizontalConnector(rows[topIndex])) continue;
    for (
      let bottomIndex = topIndex + 1;
      bottomIndex < rows.length;
      bottomIndex += 1
    ) {
      if (
        !rowHasStrongHorizontalConnector(rows[bottomIndex]) ||
        rows[bottomIndex].centerY - rows[topIndex].centerY <
          typicalHeight * 2 ||
        alignedAnchorCount(
          rows[topIndex],
          rows[bottomIndex],
          typicalHeight
        ) < 2
      ) {
        continue;
      }

      const interveningFragments = rows
        .slice(topIndex + 1, bottomIndex)
        .flatMap((row) => row.fragments);
      const interveningConnectors = interveningFragments.filter((fragment) =>
        DIAGRAM_CONNECTOR.test(fragment.text)
      ).length;
      const interveningText = interveningFragments
        .map((fragment) => fragment.text)
        .join("");
      if (
        interveningConnectors < 2 &&
        !/[↑↓↕⇑⇓\uE000-\uF8FF]/u.test(interveningText)
      ) {
        continue;
      }

      pairCandidates.push({
        topIndex,
        bottomIndex,
        bounds: rectUnion(
          [
            ...rows[topIndex].fragments,
            ...rows[bottomIndex].fragments
          ].map((fragment) => fragment.rect)
        ),
        verticalSpan:
          rows[bottomIndex].centerY - rows[topIndex].centerY
      });
    }
  }
  const pair = pairCandidates.sort(
    (left, right) =>
      left.verticalSpan - right.verticalSpan ||
      left.bounds.width - right.bounds.width ||
      left.topIndex - right.topIndex
  )[0];
  if (!pair) return null;

  const componentFragments = rows
    .slice(pair.topIndex, pair.bottomIndex + 1)
    .flatMap((row) => row.fragments)
    .filter((fragment) => {
      const centerX = (fragment.rect.left + fragment.rect.right) / 2;
      return centerX >= pair.bounds.left && centerX <= pair.bounds.right;
    });
  const componentText =
    componentFragments.map((fragment) => fragment.text).join("") ||
    nativeText;
  if (
    componentFragments.length < 6 ||
    proseWords(componentText).length > 2
  ) {
    return null;
  }

  const rects = deduplicateSelectionRects(
    componentFragments.map((fragment) => fragment.rect)
  );
  const componentRows = groupDiagramRows(
    componentFragments,
    typicalHeight
  );
  const layoutText = buildDiagramLayoutText(
    componentRows,
    componentFragments,
    typicalHeight
  );
  return layoutText
    ? { selectedFragments: componentFragments, rects, layoutText }
    : null;
}

function selectedFormulaRects(
  fragments: FormulaSelectionFragment[]
): RectLike[] {
  const selectedRects = fragments
    .filter(
      (fragment) =>
        fragment.selected &&
        fragment.rect.width >= 1 &&
        fragment.rect.height >= 1
    )
    .map((fragment) => fragment.rect);
  if (selectedRects.length === 0) return [];

  const typicalHeight = median(selectedRects.map((rect) => rect.height));
  return mergeFormulaLineRects(selectedRects, typicalHeight);
}

function rangeGeometryIsInflated(
  rangeRects: RectLike[],
  fragmentRects: RectLike[],
  typicalHeight: number
): boolean {
  const validRangeRects = rangeRects.filter(
    (rect) => rect.width >= 1 && rect.height >= 1
  );
  if (
    validRangeRects.length === 0 ||
    fragmentRects.length === 0 ||
    typicalHeight <= 0
  ) {
    return false;
  }

  const rangeBounds = rectUnion(validRangeRects);
  const fragmentBounds = rectUnion(fragmentRects);
  const tolerance = typicalHeight * 1.25;
  return (
    rangeBounds.left < fragmentBounds.left - tolerance ||
    rangeBounds.right > fragmentBounds.right + tolerance ||
    rangeBounds.top < fragmentBounds.top - tolerance ||
    rangeBounds.bottom > fragmentBounds.bottom + tolerance
  );
}

function isStructuralFormulaFragment(text: string): boolean {
  const compact = text.replace(/\s/g, "");
  return (
    compact.length > 0 &&
    /^[=≠≈≤≥∑∏∫√∞∈∉⊂⊆∪∩→←↦+\-−*/()[\]{}|,:;.]+$/u.test(compact)
  );
}

/**
 * PDF formula glyphs are frequently split into independently positioned text
 * spans. In OCR PDFs, a visual subscript or large-operator limit can even occur
 * after the rest of the equation in DOM order, so the browser Range excludes
 * it. Recover only nearby, visually enclosed spans from a single formula line;
 * normal prose and multiline selections continue to use the native Range.
 */
export function repairFormulaSelectionGeometry(
  nativeText: string,
  rangeRects: RectLike[],
  fragments: FormulaSelectionFragment[]
): FormulaSelectionRepair | null {
  if (!isSingleLineFormulaSelection(nativeText, rangeRects, fragments)) {
    return null;
  }

  const selectedFragments = fragments.filter(
    (fragment) =>
      fragment.selected &&
      fragment.rect.width >= 1 &&
      fragment.rect.height >= 1
  );

  const typicalHeight = median(
    selectedFragments.map((fragment) => fragment.rect.height)
  );
  const selectedRects = selectedFragments.map((fragment) => fragment.rect);
  const validRangeRects = rangeRects.filter(
    (rect) => rect.width >= 1 && rect.height >= 1
  );
  const baseRects = rangeGeometryIsInflated(
    validRangeRects,
    selectedRects,
    typicalHeight
  )
    ? selectedRects
    : validRangeRects;
  const selectionBounds = rectUnion(baseRects);

  const horizontalTolerance = Math.max(1, typicalHeight * 0.08);
  const verticalTolerance = Math.max(2, typicalHeight * 0.65);
  const addedFragments = fragments.filter((fragment) => {
    if (
      fragment.selected ||
      fragment.text.trim().length === 0 ||
      fragment.rect.width < 1 ||
      fragment.rect.height < 1
    ) {
      return false;
    }

    const horizontalCenter = (fragment.rect.left + fragment.rect.right) / 2;
    const horizontallyEnclosed =
      horizontalCenter >= selectionBounds.left - horizontalTolerance &&
      horizontalCenter <= selectionBounds.right + horizontalTolerance;
    const nearestVerticalGap = Math.min(
      ...selectedFragments.map((selectedFragment) =>
        verticalGap(fragment.rect, selectedFragment.rect)
      )
    );
    const isScriptSized = fragment.rect.height <= typicalHeight * 0.82;
    const isAttachedToSelectedFragment = selectedFragments.some(
      (selectedFragment) =>
        horizontalGap(fragment.rect, selectedFragment.rect) <=
        typicalHeight * 1.5
    );

    return (
      horizontallyEnclosed &&
      isAttachedToSelectedFragment &&
      ((isScriptSized && nearestVerticalGap <= verticalTolerance) ||
        (isStructuralFormulaFragment(fragment.text) &&
          nearestVerticalGap <= typicalHeight * 1.65))
    );
  });

  if (addedFragments.length === 0) return null;

  return {
    addedFragments,
    rects: mergeFormulaLineRects(
      [
        ...baseRects,
        ...addedFragments.map((fragment) => fragment.rect)
      ],
      typicalHeight
    )
  };
}

function closestPdfPage(node: Node): HTMLElement | null {
  return elementFromNode(node)?.closest<HTMLElement>("[data-pdf-page]") ?? null;
}

function directTextLayer(node: Node): HTMLElement | null {
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const element = node as HTMLElement;
  return element.classList.contains("textLayer") ? element : null;
}

function distanceToInterval(
  value: number,
  start: number,
  end: number
): number {
  if (value < start) return start - value;
  if (value > end) return value - end;
  return 0;
}

interface ResolvedSelectionEndpoint {
  node: Node;
  offset: number;
  page: HTMLElement;
}

function resolveTextLayerEndpoint(
  node: Node,
  offset: number,
  point: ViewportPoint,
  root: HTMLElement
): ResolvedSelectionEndpoint | null {
  const textLayer = directTextLayer(node);
  if (!textLayer) {
    const page = closestPdfPage(node);
    return page && root.contains(node) && root.contains(page)
      ? { node, offset, page }
      : null;
  }

  const page = closestPdfPage(textLayer);
  if (!page || !root.contains(page)) return null;

  const pageRect = page.getBoundingClientRect();
  if (
    pageRect.width < 1 ||
    pageRect.height < 1 ||
    point.x < pageRect.left ||
    point.x > pageRect.right ||
    point.y < pageRect.top ||
    point.y > pageRect.bottom
  ) {
    return null;
  }

  const candidates = Array.from(
    textLayer.querySelectorAll<HTMLElement>("span[role='presentation']")
  )
    .map((span) => {
      const textNode = Array.from(span.childNodes).find(
        (child) =>
          child.nodeType === Node.TEXT_NODE &&
          (child.textContent ?? "").trim().length > 0
      );
      return {
        rect: span.getBoundingClientRect(),
        textNode
      };
    })
    .filter(
      (
        candidate
      ): candidate is { rect: DOMRect; textNode: ChildNode } =>
        Boolean(
          candidate.textNode &&
            candidate.rect.width >= 1 &&
            candidate.rect.height >= 1
        )
    );
  if (candidates.length === 0) return null;

  const typicalHeight = median(
    candidates.map((candidate) => candidate.rect.height)
  );
  const maximumHorizontalDistance = typicalHeight * 2.5;
  const maximumVerticalDistance = typicalHeight * 0.75;
  const nearest = candidates
    .map((candidate) => {
      const horizontalDistance = distanceToInterval(
        point.x,
        candidate.rect.left,
        candidate.rect.right
      );
      const verticalDistance = distanceToInterval(
        point.y,
        candidate.rect.top,
        candidate.rect.bottom
      );
      return {
        ...candidate,
        horizontalDistance,
        verticalDistance,
        score: horizontalDistance + verticalDistance * 4
      };
    })
    .filter(
      (candidate) =>
        candidate.horizontalDistance <= maximumHorizontalDistance &&
        candidate.verticalDistance <= maximumVerticalDistance
    )
    .sort(
      (left, right) =>
        left.score - right.score ||
        left.horizontalDistance - right.horizontalDistance
    )[0];
  if (!nearest) return null;

  const textLength = nearest.textNode.textContent?.length ?? 0;
  const midpoint = (nearest.rect.left + nearest.rect.right) / 2;
  return {
    node: nearest.textNode,
    offset: point.x <= midpoint ? 0 : textLength,
    page
  };
}

/**
 * Firefox can place a drag endpoint on PDF.js's page-wide text-layer element
 * when the pointer starts in the fractional-pixel gap beside a glyph. That
 * makes the browser select from offset zero of the entire page. Snap only
 * those invalid container endpoints to a nearby glyph on the same visual row.
 */
export function repairPdfSelectionEndpoints(
  selection: Selection | null,
  root: HTMLElement,
  dragStart: ViewportPoint,
  dragEnd: ViewportPoint
): boolean {
  if (
    !selection ||
    selection.rangeCount === 0 ||
    selection.isCollapsed ||
    !selection.anchorNode ||
    !selection.focusNode ||
    typeof selection.setBaseAndExtent !== "function"
  ) {
    return false;
  }

  const anchorNeedsRepair = Boolean(directTextLayer(selection.anchorNode));
  const focusNeedsRepair = Boolean(directTextLayer(selection.focusNode));
  if (!anchorNeedsRepair && !focusNeedsRepair) return false;

  const anchor = resolveTextLayerEndpoint(
    selection.anchorNode,
    selection.anchorOffset,
    dragStart,
    root
  );
  const focus = resolveTextLayerEndpoint(
    selection.focusNode,
    selection.focusOffset,
    dragEnd,
    root
  );
  if (!anchor || !focus || anchor.page !== focus.page) return false;

  try {
    selection.setBaseAndExtent(
      anchor.node,
      anchor.offset,
      focus.node,
      focus.offset
    );
    return true;
  } catch {
    return false;
  }
}

function rangeIntersectsNode(range: Range, node: Node): boolean {
  try {
    return range.intersectsNode(node);
  } catch {
    return false;
  }
}

function collectFormulaFragments(
  pageElement: HTMLElement,
  range: Range
): FormulaSelectionFragment[] {
  return Array.from(
    pageElement.querySelectorAll<HTMLElement>(
      ".textLayer span[role='presentation']"
    )
  )
    .map((span) => ({
      text: span.textContent ?? "",
      rect: span.getBoundingClientRect(),
      selected: rangeIntersectsNode(range, span)
    }))
    .filter(
      (fragment) =>
        fragment.text.length > 0 &&
        fragment.rect.width >= 1 &&
        fragment.rect.height >= 1
    );
}

function pageCanvas(pageElement: HTMLElement): HTMLCanvasElement | null {
  return (
    pageElement.querySelector<HTMLCanvasElement>(
      "canvas.react-pdf__Page__canvas"
    ) ?? pageElement.querySelector<HTMLCanvasElement>("canvas")
  );
}

export function normalizeFormulaRegion(
  selectionRects: RectLike[],
  canvasRect: RectLike,
  pageNumber: number
): FormulaRegion | null {
  if (!Number.isInteger(pageNumber) || pageNumber < 1) return null;
  const bounds = selectionRects.filter((rect) =>
    rectOverlapsPage(rect, canvasRect)
  );
  if (bounds.length === 0) return null;

  const normalized = normalizeRect(rectUnion(bounds), canvasRect);
  return normalized ? { pageNumber, ...normalized } : null;
}

export function calculateCanvasCrop(
  selectionRects: RectLike[],
  canvasRect: RectLike,
  canvasWidth: number,
  canvasHeight: number,
  kind: VisualCropKind = "formula"
): CanvasCrop | null {
  if (
    canvasRect.width <= 0 ||
    canvasRect.height <= 0 ||
    canvasWidth <= 0 ||
    canvasHeight <= 0
  ) {
    return null;
  }

  const clippedRects = selectionRects
    .filter((rect) => rectOverlapsPage(rect, canvasRect))
    .map((rect) => {
      const left = Math.max(rect.left, canvasRect.left);
      const top = Math.max(rect.top, canvasRect.top);
      const right = Math.min(rect.right, canvasRect.right);
      const bottom = Math.min(rect.bottom, canvasRect.bottom);
      return {
        left,
        top,
        right,
        bottom,
        width: right - left,
        height: bottom - top
      };
    })
    .filter((rect) => rect.width >= 1 && rect.height >= 1);
  if (clippedRects.length === 0) return null;

  const bounds = rectUnion(clippedRects);
  const horizontalPadding =
    kind === "diagram"
      ? Math.min(8, Math.max(3, bounds.height * 0.12))
      : Math.min(10, Math.max(5, bounds.height * 0.35));
  const verticalPadding =
    kind === "diagram"
      ? Math.min(4, Math.max(2, bounds.height * 0.08))
      : Math.min(8, Math.max(4, bounds.height * 0.22));
  const left = Math.max(canvasRect.left, bounds.left - horizontalPadding);
  const top = Math.max(canvasRect.top, bounds.top - verticalPadding);
  const right = Math.min(canvasRect.right, bounds.right + horizontalPadding);
  const bottom = Math.min(canvasRect.bottom, bounds.bottom + verticalPadding);

  const scaleX = canvasWidth / canvasRect.width;
  const scaleY = canvasHeight / canvasRect.height;
  const sourceLeft = Math.max(
    0,
    Math.floor((left - canvasRect.left) * scaleX)
  );
  const sourceTop = Math.max(
    0,
    Math.floor((top - canvasRect.top) * scaleY)
  );
  const sourceRight = Math.min(
    canvasWidth,
    Math.ceil((right - canvasRect.left) * scaleX)
  );
  const sourceBottom = Math.min(
    canvasHeight,
    Math.ceil((bottom - canvasRect.top) * scaleY)
  );
  const sourceWidth = sourceRight - sourceLeft;
  const sourceHeight = sourceBottom - sourceTop;

  return sourceWidth >= 1 && sourceHeight >= 1
    ? { sourceLeft, sourceTop, sourceWidth, sourceHeight }
    : null;
}

function captureFormulaSelectionImage(
  pageElement: HTMLElement,
  selectionRects: RectLike[],
  kind: VisualCropKind = "formula"
): string | undefined {
  const canvas = pageCanvas(pageElement);
  if (!canvas || canvas.width <= 0 || canvas.height <= 0) return undefined;

  const canvasRect = canvas.getBoundingClientRect();
  const crop = calculateCanvasCrop(
    selectionRects,
    canvasRect,
    canvas.width,
    canvas.height,
    kind
  );
  if (!crop) return undefined;
  const { sourceLeft, sourceTop, sourceWidth, sourceHeight } = crop;

  const outputScale = Math.min(
    1,
    MAX_FORMULA_IMAGE_WIDTH / sourceWidth,
    MAX_FORMULA_IMAGE_HEIGHT / sourceHeight
  );
  const outputCanvas = document.createElement("canvas");
  outputCanvas.width = Math.max(1, Math.round(sourceWidth * outputScale));
  outputCanvas.height = Math.max(1, Math.round(sourceHeight * outputScale));
  const context = outputCanvas.getContext("2d");
  if (!context) return undefined;

  try {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, outputCanvas.width, outputCanvas.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(
      canvas,
      sourceLeft,
      sourceTop,
      sourceWidth,
      sourceHeight,
      0,
      0,
      outputCanvas.width,
      outputCanvas.height
    );

    let dataUrl = outputCanvas.toDataURL("image/webp", 0.92);
    if (!dataUrl.startsWith("data:image/webp")) {
      dataUrl = outputCanvas.toDataURL("image/png");
    } else if (dataUrl.length > MAX_FORMULA_IMAGE_LENGTH) {
      dataUrl = outputCanvas.toDataURL("image/webp", 0.76);
    }

    return dataUrl.length <= MAX_FORMULA_IMAGE_LENGTH ? dataUrl : undefined;
  } catch {
    // Some remotely sourced PDF images can taint a canvas. Text selection
    // remains usable even when the rendered crop cannot be exported.
    return undefined;
  }
}

export function capturePdfSelection(
  selection: Selection | null,
  root: HTMLElement
): CapturedSelection | null {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const origin = elementFromNode(range.commonAncestorContainer);
  if (!origin || !root.contains(origin)) return null;

  const nativeText = cleanSelectedText(selection.toString());
  const pageElements = Array.from(
    root.querySelectorAll<HTMLElement>("[data-pdf-page]")
  );
  let rangeRects: RectLike[] = deduplicateSelectionRects(
    Array.from(range.getClientRects()).filter(
      (rect) => rect.width >= 1 && rect.height >= 1
    )
  );
  if (rangeRects.length === 0) return null;

  const startPage = closestPdfPage(range.startContainer);
  const endPage = closestPdfPage(range.endContainer);
  let geometryRepair: FormulaSelectionRepair | null = null;
  let formulaFragments: FormulaSelectionFragment[] = [];
  let formulaSelection = false;
  let diagramSelection: DiagramSelectionCandidate | null = null;

  if (
    startPage &&
    startPage === endPage &&
    root.contains(startPage) &&
    elementFromNode(range.startContainer)?.closest(".textLayer") &&
    elementFromNode(range.endContainer)?.closest(".textLayer")
  ) {
    formulaFragments = collectFormulaFragments(startPage, range);
    diagramSelection = detectDiagramSelection(
      nativeText,
      formulaFragments
    );
    if (diagramSelection) {
      rangeRects = diagramSelection.rects;
    } else {
      formulaSelection = isSingleLineFormulaSelection(
        nativeText,
        rangeRects,
        formulaFragments
      );
      geometryRepair = repairFormulaSelectionGeometry(
        nativeText,
        rangeRects,
        formulaFragments
      );
      if (geometryRepair) {
        rangeRects = geometryRepair.rects;
      } else if (formulaSelection) {
        const selectedFragmentRects = selectedFormulaRects(formulaFragments);
        const typicalHeight = median(
          selectedFragmentRects.map((rect) => rect.height)
        );
        if (
          rangeGeometryIsInflated(
            rangeRects,
            selectedFragmentRects,
            typicalHeight
          )
        ) {
          rangeRects = selectedFragmentRects;
        }
      }
    }
  }

  // A corrupt OCR text layer cannot be corrected from geometry alone. Keep the
  // browser's logical text when it is usable; recovered glyphs still extend the
  // visual highlight. If native extraction is nearly empty, the recovered span
  // labels are a more useful last resort.
  const text =
    nativeText.length >= 2
      ? nativeText
      : cleanSelectedText(
          [
            formulaFragments
              .filter((fragment) => fragment.selected)
              .map((fragment) => fragment.text)
              .join(""),
            ...(geometryRepair?.addedFragments.map(
              (fragment) => fragment.text
            ) ?? [])
          ].join(" ")
        );
  if (text.length < 2) return null;

  const groupedPages: HighlightPage[] = [];

  for (const pageElement of pageElements) {
    const pageNumber = Number(pageElement.dataset.pdfPage);
    if (!Number.isFinite(pageNumber)) continue;

    const pageRect = pageElement.getBoundingClientRect();
    const rects = rangeRects
      .filter((rect) => rectOverlapsPage(rect, pageRect))
      .map((rect) => normalizeRect(rect, pageRect))
      .filter((rect): rect is NormalizedRect => Boolean(rect));

    if (rects.length > 0) {
      groupedPages.push({ pageNumber, rects });
    }
  }

  if (groupedPages.length === 0) return null;

  const union = rectUnion(rangeRects);
  const visualSelection = Boolean(diagramSelection || formulaSelection);
  const visualCanvas =
    visualSelection && startPage ? pageCanvas(startPage) : null;
  const visualPageNumber = startPage
    ? Number(startPage.dataset.pdfPage)
    : Number.NaN;
  const visualRegionBox =
    visualCanvas ??
    (diagramSelection && startPage ? startPage : null);
  const visualRegion =
    visualRegionBox && Number.isInteger(visualPageNumber)
      ? normalizeFormulaRegion(
          rangeRects,
          visualRegionBox.getBoundingClientRect(),
          visualPageNumber
        )
      : null;
  const previewImage =
    visualSelection && startPage
      ? captureFormulaSelectionImage(
          startPage,
          rangeRects,
          diagramSelection ? "diagram" : "formula"
        )
      : undefined;
  let content: HighlightContent = { kind: "text" };
  if (diagramSelection && visualRegion) {
    content = {
      kind: "diagram",
      region: visualRegion,
      ...(previewImage ? { previewImage } : {}),
      layoutText: diagramSelection.layoutText
    };
  } else if (formulaSelection) {
    content = {
      kind: "formula",
      ...(visualRegion ? { region: visualRegion } : {}),
      ...(previewImage ? { previewImage } : {})
    };
  }

  return {
    text: text.slice(0, 8_000),
    pageNumber: groupedPages[0].pageNumber,
    pages: groupedPages,
    content,
    geometryRepaired: Boolean(geometryRepair),
    viewportAnchor: {
      left: union.left + union.width / 2,
      top: union.top,
      bottom: union.bottom
    }
  };
}
