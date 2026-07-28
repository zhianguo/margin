import {
  AlertCircle,
  BookOpenCheck,
  Check,
  ChevronRight,
  Clipboard,
  Lightbulb,
  LoaderCircle,
  Pencil,
  RefreshCw,
  RotateCcw,
  Save,
  Sparkles,
  Trash2,
  X
} from "lucide-react";
import { useEffect, useState } from "react";
import type {
  ExplainMode,
  ExplanationRecord,
  Highlight,
  LlmProvider,
  ProviderStatus
} from "../types";
import type { FormulaRecognitionState } from "../lib/formula-recognition";
import {
  getEffectiveFormulaLatex,
  normalizeFormulaLatex
} from "../lib/formula-notation";
import { formatDisplayMath } from "../lib/math";
import { InlineRichText, RichText } from "./RichText";

interface ExplanationPanelProps {
  highlight: Highlight | null;
  mode: ExplainMode;
  record?: ExplanationRecord;
  formulaRecognition?: FormulaRecognitionState;
  visualPreviewImage?: string;
  canTreatAsDiagram?: boolean;
  providerStatus: ProviderStatus | null;
  onModeChange: (mode: ExplainMode) => void;
  onExplain: () => void;
  onRecognizeFormula: () => void;
  onExplainWithExtractedText: () => void;
  onSaveFormulaLatex: (latex: string) => void;
  onResetFormulaLatex: () => void;
  onTreatAsDiagram: () => void;
  onTreatAsText: () => void;
  onDelete: () => void;
  onClose: () => void;
}

const modes: Array<{ value: ExplainMode; label: string }> = [
  { value: "plain", label: "Plain language" },
  { value: "deep", label: "Go deeper" },
  { value: "equation", label: "Math lens" }
];

const providerEnvironmentExamples: Record<LlmProvider, string> = {
  openai: ".env.example",
  llamacpp: ".env.llamacpp.example",
  gemini: ".env.gemini.example",
  "openai-compatible": ".env.openai-compatible.example"
};

function quoteExcerpt(text: string): string {
  return text.length > 420 ? `${text.slice(0, 420).trim()}…` : text;
}

export function ExplanationPanel({
  highlight,
  mode,
  record,
  formulaRecognition,
  visualPreviewImage,
  canTreatAsDiagram = false,
  providerStatus,
  onModeChange,
  onExplain,
  onRecognizeFormula,
  onExplainWithExtractedText,
  onSaveFormulaLatex,
  onResetFormulaLatex,
  onTreatAsDiagram,
  onTreatAsText,
  onDelete,
  onClose
}: ExplanationPanelProps) {
  const [copied, setCopied] = useState(false);
  const [formulaCopied, setFormulaCopied] = useState(false);
  const [editingFormula, setEditingFormula] = useState(false);
  const [formulaDraft, setFormulaDraft] = useState("");
  const [formulaEditError, setFormulaEditError] = useState("");
  const explanation = record?.data;
  const formulaContent =
    highlight?.content.kind === "formula" ? highlight.content : null;
  const diagramContent =
    highlight?.content.kind === "diagram" ? highlight.content : null;
  const formulaPreviewImage = formulaContent
    ? visualPreviewImage ?? formulaContent.previewImage
    : undefined;
  const effectiveFormulaLatex = highlight
    ? getEffectiveFormulaLatex(highlight)
    : undefined;
  const formulaRecognitionBusy = Boolean(
    formulaContent && formulaRecognition?.status === "loading"
  );
  const formulaRecognitionFailed = Boolean(
    formulaContent && formulaRecognition?.status === "error"
  );
  const formulaRecognitionError =
    formulaRecognitionFailed
      ? formulaRecognition?.error ?? "The formula could not be transcribed."
      : null;
  const diagramPreviewImage = diagramContent
    ? visualPreviewImage ?? diagramContent.previewImage
    : undefined;
  const normalizedFormulaDraft = editingFormula
    ? normalizeFormulaLatex(formulaDraft)
    : null;

  useEffect(() => {
    setEditingFormula(false);
    setFormulaDraft(effectiveFormulaLatex ?? "");
    setFormulaEditError("");
    setFormulaCopied(false);
  }, [highlight?.id]);

  useEffect(() => {
    if (!editingFormula) setFormulaDraft(effectiveFormulaLatex ?? "");
  }, [editingFormula, effectiveFormulaLatex]);

  const copyExplanation = async () => {
    if (!explanation) return;
    const text = [
      explanation.title,
      explanation.summary,
      explanation.intuition,
      ...explanation.details,
      ...explanation.terms.map((term) => `${term.term}: ${term.meaning}`),
      ...explanation.equations.map(
        (equation) => `${equation.expression}: ${equation.interpretation}`
      )
    ].join("\n\n");
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };

  const copyFormulaLatex = async () => {
    if (!effectiveFormulaLatex) return;
    await navigator.clipboard.writeText(effectiveFormulaLatex);
    setFormulaCopied(true);
    window.setTimeout(() => setFormulaCopied(false), 1_500);
  };

  const beginFormulaEdit = () => {
    setFormulaDraft(effectiveFormulaLatex ?? "");
    setFormulaEditError("");
    setEditingFormula(true);
  };

  const saveFormulaEdit = () => {
    const normalized = normalizeFormulaLatex(formulaDraft);
    if (!normalized) {
      setFormulaEditError(
        "Enter valid KaTeX notation without surrounding math delimiters."
      );
      return;
    }
    onSaveFormulaLatex(normalized);
    setFormulaEditError("");
    setEditingFormula(false);
  };

  return (
    <aside className="explanation-panel" aria-label="Explanation">
      <div className="explanation-header">
        <div>
          <span className="panel-kicker">Reading companion</span>
          <h2>Make sense of it</h2>
          {providerStatus ? (
            <span
              className={`provider-badge${
                !providerStatus.aiConfigured ||
                providerStatus.providerReachable === false
                  ? " is-offline"
                  : ""
              }`}
              title={`${providerStatus.providerLabel} · ${providerStatus.model}`}
            >
              <i />
              {providerStatus.providerLabel}
              <small>{providerStatus.model}</small>
            </span>
          ) : null}
        </div>
        <button className="panel-close" type="button" aria-label="Close explanation panel" onClick={onClose}>
          <X size={17} />
        </button>
      </div>

      {!highlight ? (
        <div className="explanation-welcome">
          <div className="welcome-orbit">
            <Sparkles size={22} />
          </div>
          <h3>Select what feels dense.</h3>
          <p>
            Highlight a passage in the paper, then choose <strong>Explain</strong>.
            Margin will use the selection and its page—not the whole PDF.
          </p>
          <ol>
            <li>
              <span>1</span>
              Drag across selectable text
            </li>
            <li>
              <span>2</span>
              Choose the explanation lens
            </li>
            <li>
              <span>3</span>
              Keep the useful insight nearby
            </li>
          </ol>
          <div className="welcome-tip">
            <Lightbulb size={15} />
            <span>Try one or two sentences at a time for the clearest explanation.</span>
          </div>
        </div>
      ) : (
        <div className="explanation-content">
          <section className="selection-card">
            <div className="selection-card-meta">
              <span>
                {highlight.content.kind === "formula"
                  ? "Selected formula"
                  : highlight.content.kind === "diagram"
                    ? "Selected diagram"
                    : "Selected passage"}{" "}
                · p. {highlight.pages[0]?.pageNumber}
              </span>
              <button type="button" aria-label="Delete highlight" onClick={onDelete}>
                <Trash2 size={14} />
              </button>
            </div>
            {formulaContent ? (
              <div className="selection-formula">
                {formulaPreviewImage ? (
                  <img
                    src={formulaPreviewImage}
                    alt={`Selected formula image from page ${
                      highlight.pages[0]?.pageNumber ?? 1
                    }. Verify the recognized notation below.`}
                  />
                ) : null}

                {!effectiveFormulaLatex &&
                !formulaRecognitionBusy &&
                !formulaRecognitionFailed &&
                providerStatus?.formulaRecognition ? (
                  <div
                    className={`formula-provider-status${
                      !providerStatus.formulaRecognition.configured ||
                      providerStatus.formulaRecognition.reachable === false
                        ? " is-offline"
                        : ""
                    }`}
                  >
                    <i />
                    {providerStatus.formulaRecognition.configured
                      ? providerStatus.formulaRecognition.reachable === false
                        ? "Formula OCR is offline"
                        : "Formula OCR ready"
                      : "Formula OCR is not configured"}
                    {providerStatus.formulaRecognition.model ? (
                      <small>{providerStatus.formulaRecognition.model}</small>
                    ) : null}
                  </div>
                ) : null}

                {effectiveFormulaLatex ? (
                  <div className="formula-transcription">
                    <div className="formula-transcription-heading">
                      <span>
                        {formulaContent.notation?.correctedLatex
                          ? "Corrected by you"
                          : "Machine recognized—verify"}
                      </span>
                      <div>
                        <button
                          type="button"
                          onClick={() => void copyFormulaLatex()}
                        >
                          {formulaCopied ? <Check size={13} /> : <Clipboard size={13} />}
                          {formulaCopied ? "Copied" : "Copy LaTeX"}
                        </button>
                        <button type="button" onClick={beginFormulaEdit}>
                          <Pencil size={13} />
                          Edit
                        </button>
                        {formulaContent.notation?.correctedLatex &&
                        formulaContent.notation.recognizedLatex ? (
                          <button type="button" onClick={onResetFormulaLatex}>
                            <RotateCcw size={13} />
                            Reset
                          </button>
                        ) : null}
                      </div>
                    </div>
                    <RichText className="formula-transcription-preview">
                      {formatDisplayMath(effectiveFormulaLatex)}
                    </RichText>
                  </div>
                ) : null}

                {editingFormula ? (
                  <div className="formula-editor">
                    <label htmlFor={`formula-latex-${highlight.id}`}>
                      Formula LaTeX
                    </label>
                    <textarea
                      id={`formula-latex-${highlight.id}`}
                      value={formulaDraft}
                      rows={4}
                      spellCheck={false}
                      aria-invalid={Boolean(formulaEditError)}
                      aria-describedby={
                        formulaEditError
                          ? `formula-latex-error-${highlight.id}`
                          : undefined
                      }
                      onChange={(event) => {
                        setFormulaDraft(event.target.value);
                        setFormulaEditError("");
                      }}
                    />
                    {normalizedFormulaDraft ? (
                      <RichText className="formula-editor-preview">
                        {formatDisplayMath(normalizedFormulaDraft)}
                      </RichText>
                    ) : null}
                    {formulaEditError ? (
                      <p
                        id={`formula-latex-error-${highlight.id}`}
                        className="formula-editor-error"
                        role="alert"
                      >
                        {formulaEditError}
                      </p>
                    ) : null}
                    <div className="formula-editor-actions">
                      <button
                        className="button button-secondary button-small"
                        type="button"
                        onClick={() => {
                          setFormulaDraft(effectiveFormulaLatex ?? "");
                          setFormulaEditError("");
                          setEditingFormula(false);
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        className="button button-primary button-small"
                        type="button"
                        onClick={saveFormulaEdit}
                      >
                        <Save size={13} />
                        Save notation
                      </button>
                    </div>
                  </div>
                ) : !effectiveFormulaLatex && !formulaRecognitionBusy ? (
                  <button
                    className="formula-enter-button"
                    type="button"
                    onClick={beginFormulaEdit}
                  >
                    <Pencil size={13} />
                    Enter LaTeX manually
                  </button>
                ) : null}

                {formulaRecognitionBusy ? (
                  <div className="formula-recognition-status" aria-live="polite">
                    <LoaderCircle size={14} className="spin" />
                    Reading formula symbols…
                  </div>
                ) : null}

                {formulaRecognitionFailed ? (
                  <div className="formula-recognition-error" role="alert">
                    <AlertCircle size={15} />
                    <div>
                      <strong>Formula transcription unavailable</strong>
                      <p>{formulaRecognitionError}</p>
                      <div>
                        <button type="button" onClick={onRecognizeFormula}>
                          <RefreshCw size={13} />
                          Retry formula OCR
                        </button>
                        <button
                          type="button"
                          onClick={onExplainWithExtractedText}
                        >
                          Explain with extracted text
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}

                <details>
                  <summary>Extracted text (may be inaccurate)</summary>
                  <blockquote>“{quoteExcerpt(highlight.text)}”</blockquote>
                </details>
              </div>
            ) : diagramContent ? (
              <div className="selection-diagram">
                <div className="diagram-preview-heading">
                  <h3>Faithful page image</h3>
                  <span>Use this image to read the diagram’s spatial layout.</span>
                </div>
                {diagramPreviewImage ? (
                  <figure>
                    <img
                      src={diagramPreviewImage}
                      alt={`Selected diagram from page ${
                        highlight.pages[0]?.pageNumber ?? 1
                      }, shown as a faithful image from the PDF.`}
                    />
                    <figcaption>
                      Diagram structure is preserved directly from the PDF page.
                    </figcaption>
                  </figure>
                ) : (
                  <div className="diagram-preview-pending" role="status">
                    Preparing a faithful diagram image…
                  </div>
                )}
                <details className="diagram-extracted-details">
                  <summary>Approximate layout and extracted text</summary>
                  {diagramContent.layoutText ? (
                    <>
                      <span className="diagram-detail-label">
                        Approximate layout
                      </span>
                      <pre aria-label="Approximate diagram layout">
                        {diagramContent.layoutText}
                      </pre>
                    </>
                  ) : null}
                  <span className="diagram-detail-label">
                    Raw extracted text
                  </span>
                  <blockquote>“{quoteExcerpt(highlight.text)}”</blockquote>
                </details>
                <button
                  className="selection-kind-action"
                  type="button"
                  onClick={onTreatAsText}
                >
                  Treat as text
                </button>
              </div>
            ) : (
              <div className="selection-text">
                <blockquote>“{quoteExcerpt(highlight.text)}”</blockquote>
                {canTreatAsDiagram ? (
                  <button
                    className="selection-kind-action"
                    type="button"
                    onClick={onTreatAsDiagram}
                  >
                    Treat as diagram
                  </button>
                ) : null}
              </div>
            )}
          </section>

          <div className="mode-tabs" role="tablist" aria-label="Explanation depth">
            {modes.map((item) => (
              <button
                type="button"
                role="tab"
                aria-selected={mode === item.value}
                className={mode === item.value ? "is-active" : ""}
                key={item.value}
                onClick={() => onModeChange(item.value)}
              >
                {item.label}
              </button>
            ))}
          </div>

          {(!record || record.status === "idle") &&
          !formulaRecognitionBusy &&
          !formulaRecognitionFailed &&
          !editingFormula ? (
            <div className="explain-ready">
              <Sparkles size={20} />
              <p>Ready to unpack this passage with its surrounding page context.</p>
              <button className="button button-primary button-full" type="button" onClick={onExplain}>
                Explain this passage
                <ChevronRight size={16} />
              </button>
            </div>
          ) : null}

          {record?.status === "loading" ? (
            <div className="explanation-loading" aria-live="polite">
              <div className="loading-heading">
                <LoaderCircle size={17} className="spin" />
                Building the missing context…
              </div>
              <div className="skeleton-line skeleton-wide" />
              <div className="skeleton-line" />
              <div className="skeleton-line skeleton-short" />
              <div className="skeleton-block" />
            </div>
          ) : null}

          {record?.status === "error" ? (
            <div className="explanation-error" role="alert">
              <AlertCircle size={19} />
              <div>
                <strong>Explanation unavailable</strong>
                <p>{record.error}</p>
                {record.errorCode === "MISSING_PROVIDER_CONFIG" ? (
                  <code>
                    {`cp ${
                      providerEnvironmentExamples[
                        providerStatus?.provider ?? "openai"
                      ]
                    } .env`}
                  </code>
                ) : null}
              </div>
              <button className="button button-secondary button-small" type="button" onClick={onExplain}>
                Try again
              </button>
            </div>
          ) : null}

          {record?.status === "success" && explanation ? (
            <article className="explanation-answer">
              <div className="answer-heading">
                <div className="answer-icon">
                  <Sparkles size={16} />
                </div>
                <div>
                  <span className="answer-kicker">The short version</span>
                  <h3>
                    <InlineRichText>{explanation.title}</InlineRichText>
                  </h3>
                </div>
              </div>

              <RichText className="answer-summary">{explanation.summary}</RichText>

              <section className="answer-section intuition-section">
                <div className="answer-section-label">
                  <Lightbulb size={15} />
                  <span>Intuition</span>
                </div>
                <RichText>{explanation.intuition}</RichText>
              </section>

              {explanation.details.length > 0 ? (
                <section className="answer-section">
                  <div className="answer-section-label">
                    <BookOpenCheck size={15} />
                    <span>How the idea unfolds</span>
                  </div>
                  <ol className="detail-list">
                    {explanation.details.map((detail, index) => (
                      <li key={`${index}-${detail}`}>
                        <span>{index + 1}</span>
                        <RichText>{detail}</RichText>
                      </li>
                    ))}
                  </ol>
                </section>
              ) : null}

              {explanation.terms.length > 0 ? (
                <section className="answer-section">
                  <div className="answer-section-label">
                    <span>Key terms</span>
                  </div>
                  <dl className="term-list">
                    {explanation.terms.map((term) => (
                      <div key={term.term}>
                        <dt>
                          <InlineRichText>{term.term}</InlineRichText>
                        </dt>
                        <dd>
                          <RichText>{term.meaning}</RichText>
                        </dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ) : null}

              {explanation.equations.length > 0 ? (
                <section className="answer-section equation-section">
                  <div className="answer-section-label">
                    <span>Read the math</span>
                  </div>
                  {explanation.equations.map((equation) => (
                    <div className="equation-card" key={equation.expression}>
                      <RichText className="equation-expression">
                        {formatDisplayMath(equation.expression)}
                      </RichText>
                      <RichText>{equation.interpretation}</RichText>
                    </div>
                  ))}
                </section>
              ) : null}

              {explanation.connections.length > 0 ? (
                <section className="answer-section">
                  <div className="answer-section-label">
                    <span>Why it matters</span>
                  </div>
                  <ul className="connection-list">
                    {explanation.connections.map((connection) => (
                      <li key={connection}>
                        <ChevronRight size={14} />
                        <RichText>{connection}</RichText>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {explanation.checkQuestion ? (
                <section className="check-card">
                  <span>Check your understanding</span>
                  <RichText>{explanation.checkQuestion}</RichText>
                </section>
              ) : null}

              {explanation.uncertainty ? (
                <section className="uncertainty-note">
                  <AlertCircle size={14} />
                  <RichText>{explanation.uncertainty}</RichText>
                </section>
              ) : null}

              <div className="answer-actions">
                <button type="button" onClick={copyExplanation}>
                  {copied ? <Check size={14} /> : <Clipboard size={14} />}
                  {copied ? "Copied" : "Copy"}
                </button>
                <button type="button" onClick={onExplain}>
                  <RefreshCw size={14} />
                  Regenerate
                </button>
              </div>
            </article>
          ) : null}

          <div className="context-disclosure">
            <span className="context-dot" />
            Only this selection and its page context are sent for explanation
          </div>
        </div>
      )}
    </aside>
  );
}
