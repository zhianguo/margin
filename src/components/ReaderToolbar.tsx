import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minus,
  Plus
} from "lucide-react";

interface ReaderToolbarProps {
  currentPage: number;
  numPages: number;
  zoom: number;
  onPreviousPage: () => void;
  onNextPage: () => void;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onFitWidth: () => void;
}

export function ReaderToolbar({
  currentPage,
  numPages,
  zoom,
  onPreviousPage,
  onNextPage,
  onZoomOut,
  onZoomIn,
  onFitWidth
}: ReaderToolbarProps) {
  return (
    <div className="reader-toolbar" aria-label="PDF controls">
      <div className="toolbar-group">
        <button
          className="toolbar-icon"
          type="button"
          aria-label="Previous page"
          disabled={currentPage <= 1}
          onClick={onPreviousPage}
        >
          <ChevronLeft size={17} />
        </button>
        <button className="page-indicator" type="button" onClick={onFitWidth}>
          <span>{currentPage}</span>
          <span className="page-total">/ {numPages || "—"}</span>
          <ChevronDown size={13} />
        </button>
        <button
          className="toolbar-icon"
          type="button"
          aria-label="Next page"
          disabled={currentPage >= numPages}
          onClick={onNextPage}
        >
          <ChevronRight size={17} />
        </button>
      </div>

      <div className="toolbar-divider" />

      <div className="toolbar-group">
        <button className="toolbar-icon" type="button" aria-label="Zoom out" onClick={onZoomOut}>
          <Minus size={16} />
        </button>
        <button className="zoom-value" type="button" onClick={onFitWidth} title="Fit width">
          {Math.round(zoom * 100)}%
        </button>
        <button className="toolbar-icon" type="button" aria-label="Zoom in" onClick={onZoomIn}>
          <Plus size={16} />
        </button>
        <button className="toolbar-icon" type="button" aria-label="Fit page width" onClick={onFitWidth}>
          <Maximize2 size={15} />
        </button>
      </div>
    </div>
  );
}
