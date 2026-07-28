import { FileUp, LockKeyhole, PanelRightClose, PanelRightOpen } from "lucide-react";
import type { DocumentSource } from "../types";

interface AppHeaderProps {
  source: DocumentSource | null;
  homeOpen: boolean;
  explanationOpen: boolean;
  onOpenFile: () => void;
  onToggleExplanation: () => void;
  onHome: () => void;
}

export function AppHeader({
  source,
  homeOpen,
  explanationOpen,
  onOpenFile,
  onToggleExplanation,
  onHome
}: AppHeaderProps) {
  return (
    <header className="app-header">
      <button className="brand" type="button" onClick={onHome} aria-label="Margin home">
        <span className="brand-mark" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <span className="brand-name">Margin</span>
      </button>

      {source ? (
        <div className="header-document" title={source.name}>
          <span className="document-kicker">
            {homeOpen ? "Session ready" : "Reading"}
          </span>
          <span className="document-name">{source.name}</span>
        </div>
      ) : (
        <div className="header-tagline">A thinking space for difficult papers</div>
      )}

      <div className="header-actions">
        <span className="privacy-note">
          <LockKeyhole size={13} strokeWidth={1.8} />
          PDF file stays local
        </span>
        <button className="button button-secondary button-compact" type="button" onClick={onOpenFile}>
          <FileUp size={16} />
          <span>Open PDF</span>
        </button>
        {source && !homeOpen ? (
          <button
            className="icon-button"
            type="button"
            aria-label={explanationOpen ? "Hide explanation panel" : "Show explanation panel"}
            aria-pressed={explanationOpen}
            onClick={onToggleExplanation}
          >
            {explanationOpen ? (
              <PanelRightClose size={18} />
            ) : (
              <PanelRightOpen size={18} />
            )}
          </button>
        ) : null}
      </div>
    </header>
  );
}
