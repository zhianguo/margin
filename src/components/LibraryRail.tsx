import { BookOpenText, ChevronLeft, Highlighter, PanelLeftClose } from "lucide-react";
import type { Highlight } from "../types";

interface LibraryRailProps {
  currentPage: number;
  numPages: number;
  highlights: Highlight[];
  activeHighlightId: string | null;
  onGoToPage: (pageNumber: number) => void;
  onSelectHighlight: (highlight: Highlight) => void;
  onCollapse: () => void;
}

function excerpt(text: string, length = 92): string {
  return text.length > length ? `${text.slice(0, length).trim()}…` : text;
}

export function LibraryRail({
  currentPage,
  numPages,
  highlights,
  activeHighlightId,
  onGoToPage,
  onSelectHighlight,
  onCollapse
}: LibraryRailProps) {
  const highlightedPages = new Set(
    highlights.flatMap((highlight) => highlight.pages.map((page) => page.pageNumber))
  );

  return (
    <aside className="library-rail" aria-label="Document navigation">
      <div className="rail-heading">
        <div>
          <span className="rail-kicker">Document</span>
          <strong>Paper map</strong>
        </div>
        <button className="rail-collapse" type="button" aria-label="Collapse document rail" onClick={onCollapse}>
          <PanelLeftClose size={16} />
        </button>
      </div>

      <div className="rail-section pages-section">
        <div className="rail-section-title">
          <span>Pages</span>
          <span>{numPages || "—"}</span>
        </div>
        <div className="page-map" aria-label="Page list">
          {Array.from({ length: numPages }, (_, index) => index + 1).map((pageNumber) => (
            <button
              className={`page-map-item${pageNumber === currentPage ? " is-active" : ""}`}
              type="button"
              key={pageNumber}
              onClick={() => onGoToPage(pageNumber)}
              aria-current={pageNumber === currentPage ? "page" : undefined}
            >
              <span className="page-map-number">{String(pageNumber).padStart(2, "0")}</span>
              <span className="page-map-lines" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              {highlightedPages.has(pageNumber) ? (
                <span className="page-map-dot" title="Has highlights" />
              ) : null}
            </button>
          ))}
        </div>
      </div>

      <div className="rail-section notes-section">
        <div className="rail-section-title">
          <span>Margin notes</span>
          <span>{highlights.length}</span>
        </div>
        {highlights.length === 0 ? (
          <div className="rail-empty">
            <Highlighter size={17} />
            <p>Your saved passages will collect here.</p>
          </div>
        ) : (
          <div className="highlight-list">
            {highlights.map((highlight) => (
              <button
                className={`highlight-list-item${
                  activeHighlightId === highlight.id ? " is-active" : ""
                }`}
                type="button"
                key={highlight.id}
                onClick={() => onSelectHighlight(highlight)}
              >
                <span className="highlight-list-page">
                  p. {highlight.pages[0]?.pageNumber}
                </span>
                <span className="highlight-list-quote">“{excerpt(highlight.text)}”</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="rail-footer">
        <BookOpenText size={15} />
        <span>Highlights save in this browser</span>
        <ChevronLeft size={13} />
      </div>
    </aside>
  );
}
