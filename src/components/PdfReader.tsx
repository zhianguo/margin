import { AlertTriangle, LoaderCircle, PanelLeftOpen } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import type { PDFDocumentProxy } from "pdfjs-dist";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import {
  capturePdfSelection,
  repairPdfSelectionEndpoints,
  type ViewportPoint
} from "../lib/selection";
import type {
  CapturedSelection,
  DocumentSource,
  Highlight
} from "../types";
import { ReaderToolbar } from "./ReaderToolbar";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

interface PdfReaderProps {
  source: DocumentSource;
  highlights: Highlight[];
  pendingSelection: CapturedSelection | null;
  activeHighlightId: string | null;
  railOpen: boolean;
  onOpenRail: () => void;
  onSelection: (selection: CapturedSelection | null) => void;
  onDocumentReady: (document: PDFDocumentProxy | null) => void;
  onPageChange: (pageNumber: number) => void;
  registerNavigation: (goToPage: (pageNumber: number) => void) => void;
}

interface PdfPageProps {
  pageNumber: number;
  width: number;
  highlights: Highlight[];
  pendingSelection: CapturedSelection | null;
  activeHighlightId: string | null;
}

interface SelectionDragOrigin {
  point: ViewportPoint;
  scrollLeft: number;
  scrollTop: number;
}

function PdfPage({
  pageNumber,
  width,
  highlights,
  pendingSelection,
  activeHighlightId
}: PdfPageProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const [shouldRender, setShouldRender] = useState(pageNumber <= 2);
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    const element = shellRef.current;
    if (!element || shouldRender) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShouldRender(true);
          observer.disconnect();
        }
      },
      { rootMargin: "900px 0px" }
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [shouldRender]);

  const pageHighlights = highlights.filter((highlight) =>
    highlight.pages.some((page) => page.pageNumber === pageNumber)
  );
  const pendingPage = pendingSelection?.geometryRepaired
    ? pendingSelection.pages.find((page) => page.pageNumber === pageNumber)
    : undefined;

  return (
    <div className="pdf-page-slot" data-page-slot={pageNumber}>
      <div
        ref={shellRef}
        className={`pdf-page-shell${rendered ? " is-rendered" : ""}`}
        data-pdf-page={pageNumber}
        style={{
          width,
          minHeight: rendered ? undefined : width * 1.294
        }}
      >
        {shouldRender ? (
          <Page
            pageNumber={pageNumber}
            width={width}
            renderTextLayer
            renderAnnotationLayer
            onRenderSuccess={() => setRendered(true)}
            loading={
              <div className="page-loading" style={{ height: width * 1.294 }}>
                <LoaderCircle size={20} className="spin" />
              </div>
            }
          />
        ) : (
          <div className="page-placeholder" aria-label={`Page ${pageNumber} not rendered yet`} />
        )}

        <div className="highlight-layer" aria-hidden="true">
          {pageHighlights.flatMap((highlight) => {
            const page = highlight.pages.find(
              (entry) => entry.pageNumber === pageNumber
            );
            return (page?.rects ?? []).map((rect, index) => (
              <span
                key={`${highlight.id}-${index}`}
                className={`highlight-rect highlight-${highlight.color}${
                  activeHighlightId === highlight.id ? " is-active" : ""
                }`}
                style={{
                  left: `${rect.x * 100}%`,
                  top: `${rect.y * 100}%`,
                  width: `${rect.width * 100}%`,
                  height: `${rect.height * 100}%`
                }}
              />
            ));
          })}
          {pendingPage?.rects.map((rect, index) => (
            <span
              key={`selection-preview-${index}`}
              className="highlight-rect highlight-amber selection-preview-rect"
              style={{
                left: `${rect.x * 100}%`,
                top: `${rect.y * 100}%`,
                width: `${rect.width * 100}%`,
                height: `${rect.height * 100}%`
              }}
            />
          ))}
        </div>
      </div>
      <span className="page-number-label">{pageNumber}</span>
    </div>
  );
}

export function PdfReader({
  source,
  highlights,
  pendingSelection,
  activeHighlightId,
  railOpen,
  onOpenRail,
  onSelection,
  onDocumentReady,
  onPageChange,
  registerNavigation
}: PdfReaderProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasAreaRef = useRef<HTMLDivElement>(null);
  const scrollFrame = useRef<number | null>(null);
  const selectionDragStart = useRef<SelectionDragOrigin | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [availableWidth, setAvailableWidth] = useState(860);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    const element = canvasAreaRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setAvailableWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    selectionDragStart.current = null;
    setNumPages(0);
    setCurrentPage(1);
    setZoom(1);
    setLoadError("");
    onDocumentReady(null);
  }, [source.id, onDocumentReady]);

  const basePageWidth = Math.max(460, Math.min(840, availableWidth - 88));
  const pageWidth = Math.round(basePageWidth * zoom);

  const goToPage = useCallback(
    (pageNumber: number) => {
      const next = Math.max(1, Math.min(numPages || 1, pageNumber));
      const target = scrollRef.current?.querySelector<HTMLElement>(
        `[data-page-slot="${next}"]`
      );
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    [numPages]
  );

  useEffect(() => {
    registerNavigation(goToPage);
  }, [goToPage, registerNavigation]);

  const updateVisiblePage = useCallback(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) return;
    const toolbarOffset = scrollElement.getBoundingClientRect().top + 90;
    const pages = Array.from(
      scrollElement.querySelectorAll<HTMLElement>("[data-page-slot]")
    );
    if (pages.length === 0) return;

    let closestPage = currentPage;
    let closestDistance = Number.POSITIVE_INFINITY;
    for (const page of pages) {
      const distance = Math.abs(page.getBoundingClientRect().top - toolbarOffset);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestPage = Number(page.dataset.pageSlot);
      }
    }

    if (closestPage !== currentPage && Number.isFinite(closestPage)) {
      setCurrentPage(closestPage);
      onPageChange(closestPage);
    }
  }, [currentPage, onPageChange]);

  const handleScroll = () => {
    onSelection(null);
    if (scrollFrame.current !== null) return;
    scrollFrame.current = window.requestAnimationFrame(() => {
      updateVisiblePage();
      scrollFrame.current = null;
    });
  };

  useEffect(
    () => () => {
      if (scrollFrame.current !== null) {
        window.cancelAnimationFrame(scrollFrame.current);
      }
    },
    []
  );

  useEffect(() => {
    const handleMouseUp = (event: MouseEvent) => {
      const dragStart = selectionDragStart.current;
      selectionDragStart.current = null;
      if (!dragStart || event.button !== 0) return;

      const dragEnd = { x: event.clientX, y: event.clientY };
      window.requestAnimationFrame(() => {
        const root = scrollRef.current;
        if (!root) return;

        const dragStartPoint = {
          x:
            dragStart.point.x -
            (root.scrollLeft - dragStart.scrollLeft),
          y:
            dragStart.point.y -
            (root.scrollTop - dragStart.scrollTop)
        };
        const selection = window.getSelection();
        repairPdfSelectionEndpoints(
          selection,
          root,
          dragStartPoint,
          dragEnd
        );
        onSelection(capturePdfSelection(selection, root));
      });
    };

    window.addEventListener("mouseup", handleMouseUp);
    return () => window.removeEventListener("mouseup", handleMouseUp);
  }, [onSelection]);

  return (
    <section className="pdf-reader" aria-label="PDF reader">
      {!railOpen ? (
        <button className="open-rail-button" type="button" aria-label="Open document rail" onClick={onOpenRail}>
          <PanelLeftOpen size={17} />
        </button>
      ) : null}

      <ReaderToolbar
        currentPage={currentPage}
        numPages={numPages}
        zoom={zoom}
        onPreviousPage={() => goToPage(currentPage - 1)}
        onNextPage={() => goToPage(currentPage + 1)}
        onZoomOut={() => setZoom((value) => Math.max(0.65, value - 0.1))}
        onZoomIn={() => setZoom((value) => Math.min(1.8, value + 0.1))}
        onFitWidth={() => setZoom(1)}
      />

      <div
        ref={scrollRef}
        className="pdf-scroll-area"
        onScroll={handleScroll}
        onMouseDown={(event) => {
          selectionDragStart.current =
            event.button === 0
              ? {
                  point: { x: event.clientX, y: event.clientY },
                  scrollLeft: event.currentTarget.scrollLeft,
                  scrollTop: event.currentTarget.scrollTop
                }
              : null;
        }}
      >
        <div ref={canvasAreaRef} className="pdf-canvas-area">
          {loadError ? (
            <div className="pdf-error">
              <AlertTriangle size={22} />
              <strong>This PDF could not be opened.</strong>
              <span>{loadError}</span>
            </div>
          ) : null}

          <Document
            file={source.url}
            onLoadSuccess={(document) => {
              setNumPages(document.numPages);
              setCurrentPage(1);
              onPageChange(1);
              onDocumentReady(document);
            }}
            onLoadError={(error) => {
              setLoadError(
                error instanceof Error
                  ? error.message
                  : "The file may be damaged or password protected."
              );
            }}
            loading={
              <div className="document-loading">
                <LoaderCircle size={22} className="spin" />
                <span>Setting the paper on the desk…</span>
              </div>
            }
          >
            <div className="pdf-pages">
              {Array.from({ length: numPages }, (_, index) => (
                <PdfPage
                  key={`${source.id}-${index + 1}`}
                  pageNumber={index + 1}
                  width={pageWidth}
                  highlights={highlights}
                  pendingSelection={pendingSelection}
                  activeHighlightId={activeHighlightId}
                />
              ))}
            </div>
          </Document>
        </div>
      </div>
    </section>
  );
}
