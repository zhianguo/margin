import {
  ArrowRight,
  BookOpenText,
  FileText,
  Highlighter,
  Sparkles,
  UploadCloud,
  X
} from "lucide-react";
import { useRef, useState } from "react";
import type { DocumentSource } from "../types";

interface EmptyStateProps {
  onChooseFile: () => void;
  onFileDrop: (file: File) => void;
  onOpenDemo: () => void;
  currentSource?: DocumentSource | null;
  onResume?: () => void;
  onCloseCurrent?: () => void;
  error?: string;
}

export function EmptyState({
  onChooseFile,
  onFileDrop,
  onOpenDemo,
  currentSource,
  onResume,
  onCloseCurrent,
  error
}: EmptyStateProps) {
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const hasCurrentSession = Boolean(currentSource && onResume);

  return (
    <main
      className={`empty-state${hasCurrentSession ? " has-current-session" : ""}`}
    >
      <section className="hero-copy">
        <div className="eyebrow">
          <span className="eyebrow-dot" />
          {hasCurrentSession
            ? "Reading session ready"
            : "Read beyond the abstract"}
        </div>
        {hasCurrentSession ? (
          <h1>
            Your paper is
            <br />
            <em>still open.</em>
          </h1>
        ) : (
          <h1>
            Difficult papers,
            <br />
            <em>made discussable.</em>
          </h1>
        )}
        <p className="hero-lede">
          {hasCurrentSession
            ? "Return to the same page, zoom level, highlights, and explanation panel—or open a different local PDF."
            : "Select the sentence, equation, or term that stopped you. Margin keeps your place and builds the missing intuition around it."}
        </p>

        <div className="hero-actions">
          {hasCurrentSession ? (
            <>
              <button
                className="button button-primary"
                type="button"
                onClick={onResume}
                aria-label={`Resume reading ${currentSource?.name ?? ""}`.trim()}
                autoFocus
              >
                <BookOpenText size={18} />
                Resume reading
              </button>
              <button
                className="button button-secondary"
                type="button"
                onClick={onChooseFile}
              >
                <UploadCloud size={18} />
                Open another PDF
              </button>
            </>
          ) : (
            <>
              <button
                className="button button-primary"
                type="button"
                onClick={onChooseFile}
              >
                <UploadCloud size={18} />
                Choose a PDF
              </button>
              <button className="text-button" type="button" onClick={onOpenDemo}>
                Try the demo paper
                <ArrowRight size={16} />
              </button>
            </>
          )}
        </div>

        {hasCurrentSession && onCloseCurrent ? (
          <button
            className="close-session-button"
            type="button"
            onClick={onCloseCurrent}
          >
            <X size={14} />
            Close current PDF
          </button>
        ) : null}

        {error ? <div className="inline-error">{error}</div> : null}

        <div
          className="feature-row"
          aria-label={
            hasCurrentSession ? "Current reading session" : "How Margin works"
          }
        >
          <div className="feature">
            <span className="feature-number">01</span>
            {hasCurrentSession ? (
              <BookOpenText size={18} />
            ) : (
              <Highlighter size={18} />
            )}
            <div>
              <strong>{hasCurrentSession ? "Resume" : "Select"}</strong>
              <span>
                {hasCurrentSession ? "your exact place" : "any passage"}
              </span>
            </div>
          </div>
          <div className="feature">
            <span className="feature-number">02</span>
            <Sparkles size={18} />
            <div>
              <strong>{hasCurrentSession ? "Continue" : "Unpack"}</strong>
              <span>
                {hasCurrentSession ? "your explanation" : "the hard part"}
              </span>
            </div>
          </div>
          <div className="feature">
            <span className="feature-number">03</span>
            <FileText size={18} />
            <div>
              <strong>Keep</strong>
              <span>your margin notes</span>
            </div>
          </div>
        </div>
      </section>

      <section
        className={`paper-drop-preview${dragging ? " is-dragging" : ""}`}
        onDragEnter={(event) => {
          event.preventDefault();
          dragDepth.current += 1;
          setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          event.preventDefault();
          dragDepth.current -= 1;
          if (dragDepth.current <= 0) {
            dragDepth.current = 0;
            setDragging(false);
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          const file = event.dataTransfer.files[0];
          if (file) onFileDrop(file);
        }}
      >
        <div className="preview-shadow preview-shadow-one" />
        <div className="preview-shadow preview-shadow-two" />
        <div className="preview-paper">
          <div className="preview-journal">
            {hasCurrentSession
              ? "CURRENT READING SESSION · LOCAL PDF"
              : "JOURNAL OF CONTROL & SYSTEMS · VOL. 18"}
          </div>
          <div className="preview-title">
            {currentSource?.name ?? "Stability Margins in Feedback Systems"}
          </div>
          <div className="preview-authors">
            {hasCurrentSession
              ? "Ready to resume in this browser tab"
              : "A. Raman · M. Chen · Systems Laboratory"}
          </div>
          <div className="preview-rule" />
          <div className="preview-section">
            {hasCurrentSession ? "Reading state preserved" : "Abstract"}
          </div>
          <p>
            {hasCurrentSession
              ? "Margin kept the active reader mounted while you visited Home. Your PDF remains local and available without choosing it again."
              : "Robust stability describes a system's ability to remain stable when its model is only approximately known. We connect classical margins to a geometric interpretation of uncertainty."}
          </p>
          <div className="preview-equation">
            {hasCurrentSession
              ? "page + zoom + notes"
              : "T(s) = G(s) / [1 + G(s)H(s)]"}
          </div>
          <p>
            {hasCurrentSession
              ? "Use Close current PDF to release this reading session. Opening another PDF replaces it while retaining its saved highlights."
              : "The denominator contains the characteristic equation. Its roots determine whether disturbances decay or grow over time."}
          </p>
          <span className="preview-highlight">
            {hasCurrentSession
              ? "Resume reading to return exactly where you left off"
              : "the distance to the critical point is a practical measure of robustness"}
          </span>
          <div className="preview-note">
            {hasCurrentSession ? (
              <BookOpenText size={14} />
            ) : (
              <Sparkles size={14} />
            )}
            <span>{hasCurrentSession ? "Session ready" : "Explain this"}</span>
          </div>
        </div>
        <div className="drop-instruction">
          <UploadCloud size={17} />
          {hasCurrentSession
            ? "Drop another PDF to replace this session"
            : "Drop a PDF anywhere on the paper"}
        </div>
      </section>
    </main>
  );
}
