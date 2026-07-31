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
  Search,
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
  ProviderStatus,
  WebContext,
  WebSearchFreshness,
  WebSource
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
  webSearchEnabled: boolean;
  webSearchQuery: string;
  webSearchFreshness: WebSearchFreshness;
  onModeChange: (mode: ExplainMode) => void;
  onWebSearchEnabledChange: (enabled: boolean) => void;
  onWebSearchQueryChange: (query: string) => void;
  onWebSearchFreshnessChange: (freshness: WebSearchFreshness) => void;
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

const freshnessOptions: Array<{
  value: WebSearchFreshness;
  label: string;
}> = [
  { value: "day", label: "Past day" },
  { value: "week", label: "Past week" },
  { value: "month", label: "Past month" },
  { value: "year", label: "Past year" },
  { value: "any", label: "Any time" }
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

interface NumberedWebSource {
  number: number;
  source: WebSource;
  url: string;
  domain: string;
}

function getSafeWebUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") &&
      !url.username &&
      !url.password
      ? url
      : null;
  } catch {
    return null;
  }
}

function getNumberedWebSources(webContext: WebContext): NumberedWebSource[] {
  const sourceIds = new Set<string>();

  return webContext.sources.flatMap((source) => {
    const url = getSafeWebUrl(source.url);
    if (!source.id || sourceIds.has(source.id) || !url) return [];

    sourceIds.add(source.id);
    return [
      {
        number: sourceIds.size,
        source,
        url: url.toString(),
        domain: url.hostname.replace(/^www\./, "")
      }
    ];
  });
}

function formatWebDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC"
  }).format(date);
}

export function ExplanationPanel({
  highlight,
  mode,
  record,
  formulaRecognition,
  visualPreviewImage,
  canTreatAsDiagram = false,
  providerStatus,
  webSearchEnabled,
  webSearchQuery,
  webSearchFreshness,
  onModeChange,
  onWebSearchEnabledChange,
  onWebSearchQueryChange,
  onWebSearchFreshnessChange,
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
  const webSearchAvailable = Boolean(providerStatus?.webSearch?.configured);
  const webSearchQueryInvalid =
    webSearchEnabled &&
    webSearchAvailable &&
    webSearchQuery.trim().length < 2;
  const numberedWebSources = record?.webContext
    ? getNumberedWebSources(record.webContext)
    : [];
  const numberedWebSourcesById = new Map(
    numberedWebSources.map((source) => [source.source.id, source])
  );
  const webSearchSettingsChanged = Boolean(
    record?.status === "success" &&
      webSearchAvailable &&
      (webSearchEnabled
        ? record.webContext
          ? webSearchQuery.trim() !== record.webContext.query ||
            webSearchFreshness !== record.webContext.freshness
          : !record.webSearchWarning
        : record.webContext)
  );

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
    const sections = [
      explanation.title,
      explanation.summary,
      explanation.intuition,
      ...explanation.details,
      ...explanation.terms.map((term) => `${term.term}: ${term.meaning}`),
      ...explanation.equations.map(
        (equation) => `${equation.expression}: ${equation.interpretation}`
      )
    ];

    if (record?.webContext) {
      const webContext = record.webContext;
      sections.push(
        "Latest from the web",
        `As of ${formatWebDate(webContext.searchedAt)}`,
        `Search query: ${webContext.query}`,
        webContext.summary,
        ...webContext.claims.map((claim) => {
          const citations = Array.from(new Set(claim.sourceIds))
            .map((sourceId) => numberedWebSourcesById.get(sourceId))
            .filter(
              (source): source is NumberedWebSource => source !== undefined
            )
            .map((source) => `[${source.number}]`)
            .join(" ");
          return citations ? `${claim.text} ${citations}` : claim.text;
        }),
        ...numberedWebSources.map(
          ({ number, source, url }) => `[${number}] ${source.title} — ${url}`
        )
      );
    }

    if (record?.webSearchWarning) {
      sections.push("Web search notice", record.webSearchWarning.message);
    }

    const text = sections.join("\n\n");
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
                        <button
                          type="button"
                          disabled={webSearchQueryInvalid}
                          onClick={onRecognizeFormula}
                        >
                          <RefreshCw size={13} />
                          Retry formula OCR
                        </button>
                        <button
                          type="button"
                          disabled={webSearchQueryInvalid}
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

          <section
            className={`web-search-options${
              !webSearchAvailable ? " is-unavailable" : ""
            }`}
            aria-labelledby={`web-search-label-${highlight.id}`}
          >
            <div className="web-search-toggle">
              <input
                id={`web-search-enabled-${highlight.id}`}
                type="checkbox"
                checked={webSearchEnabled}
                disabled={!webSearchAvailable}
                aria-describedby={`web-search-help-${highlight.id}`}
                onChange={(event) =>
                  onWebSearchEnabledChange(event.target.checked)
                }
              />
              <label
                id={`web-search-label-${highlight.id}`}
                htmlFor={`web-search-enabled-${highlight.id}`}
              >
                <Search size={15} aria-hidden="true" />
                <span>Include current web sources</span>
              </label>
            </div>
            <p id={`web-search-help-${highlight.id}`}>
              {webSearchAvailable
                ? `The query below goes to ${
                    providerStatus?.webSearch?.providerLabel ??
                    "the configured search provider"
                  }.`
                : `Web search is not configured. ${
                    providerStatus?.webSearch?.configurationError ??
                    "Configure a search provider to include current sources."
                  }`}
            </p>

            {webSearchEnabled && webSearchAvailable ? (
              <div className="web-search-fields">
                <label htmlFor={`web-search-query-${highlight.id}`}>
                  Search query
                  <input
                    id={`web-search-query-${highlight.id}`}
                    type="text"
                    value={webSearchQuery}
                    maxLength={300}
                    aria-invalid={webSearchQueryInvalid}
                    aria-describedby={
                      webSearchQueryInvalid
                        ? `web-search-query-error-${highlight.id}`
                        : undefined
                    }
                    placeholder="What current information should Margin look for?"
                    onChange={(event) =>
                      onWebSearchQueryChange(event.target.value)
                    }
                  />
                </label>
                <label htmlFor={`web-search-freshness-${highlight.id}`}>
                  Freshness
                  <select
                    id={`web-search-freshness-${highlight.id}`}
                    value={webSearchFreshness}
                    onChange={(event) =>
                      onWebSearchFreshnessChange(
                        event.target.value as WebSearchFreshness
                      )
                    }
                  >
                    {freshnessOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                {webSearchQueryInvalid ? (
                  <p
                    id={`web-search-query-error-${highlight.id}`}
                    className="web-search-validation"
                    role="alert"
                  >
                    Enter at least 2 characters to search the web.
                  </p>
                ) : null}
              </div>
            ) : null}

            {webSearchSettingsChanged ? (
              <p className="web-search-state-hint" role="status">
                {webSearchEnabled
                  ? "Search settings changed. Regenerate to update this explanation."
                  : "Web search is off. Regenerate to remove the existing web context."}
              </p>
            ) : null}
          </section>

          {(!record || record.status === "idle") &&
          !formulaRecognitionBusy &&
          !formulaRecognitionFailed &&
          !editingFormula ? (
            <div className="explain-ready">
              <Sparkles size={20} />
              <p>Ready to unpack this passage with its surrounding page context.</p>
              <button
                className="button button-primary button-full"
                type="button"
                disabled={webSearchQueryInvalid}
                onClick={onExplain}
              >
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
              <button
                className="button button-secondary button-small"
                type="button"
                disabled={webSearchQueryInvalid}
                onClick={onExplain}
              >
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

              {record.webSearchWarning ? (
                <section className="web-search-warning" role="status">
                  <AlertCircle size={16} aria-hidden="true" />
                  <div>
                    <strong>
                      {record.webSearchWarning.code ===
                      "WEB_SEARCH_NO_RESULTS"
                        ? "No current web results"
                        : "Current web sources unavailable"}
                    </strong>
                    <p>{record.webSearchWarning.message}</p>
                  </div>
                </section>
              ) : null}

              {record.webContext ? (
                <section
                  className="web-context"
                  aria-labelledby={`web-context-title-${highlight.id}`}
                >
                  <div className="web-context-heading">
                    <div>
                      <Search size={15} aria-hidden="true" />
                      <h4 id={`web-context-title-${highlight.id}`}>
                        Latest from the web
                      </h4>
                    </div>
                    <span>
                      As of {formatWebDate(record.webContext.searchedAt)}
                    </span>
                  </div>

                  <RichText className="web-context-summary">
                    {record.webContext.summary}
                  </RichText>
                  <p className="web-context-query">
                    <span>Search query</span>
                    {record.webContext.query}
                  </p>

                  {record.webContext.claims.length > 0 ? (
                    <ul className="web-claim-list">
                      {record.webContext.claims.map((claim, claimIndex) => {
                        const citedSources = Array.from(
                          new Set(claim.sourceIds)
                        )
                          .map((sourceId) =>
                            numberedWebSourcesById.get(sourceId)
                          )
                          .filter(
                            (
                              source
                            ): source is NumberedWebSource =>
                              source !== undefined
                          );

                        return (
                          <li key={`${claimIndex}-${claim.text}`}>
                            <RichText>{claim.text}</RichText>
                            {citedSources.length > 0 ? (
                              <span
                                className="web-claim-citations"
                                aria-label="Sources"
                              >
                                {citedSources.map(({ number, source, url }) => (
                                  <a
                                    key={source.id}
                                    href={url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    aria-label={`Source ${number}: ${source.title}`}
                                  >
                                    [{number}]
                                  </a>
                                ))}
                              </span>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}

                  {numberedWebSources.length > 0 ? (
                    <div className="web-source-section">
                      <h5>Sources</h5>
                      <ol className="web-source-list">
                        {numberedWebSources.map(
                          ({ number, source, url, domain }) => (
                            <li key={source.id} value={number}>
                              <a
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                {source.title}
                              </a>
                              <span>
                                {domain}
                                {source.publishedAt
                                  ? ` · ${formatWebDate(source.publishedAt)}`
                                  : ""}
                              </span>
                            </li>
                          )
                        )}
                      </ol>
                    </div>
                  ) : null}
                </section>
              ) : null}

              <div className="answer-actions">
                <button type="button" onClick={copyExplanation}>
                  {copied ? <Check size={14} /> : <Clipboard size={14} />}
                  {copied ? "Copied" : "Copy"}
                </button>
                <button
                  type="button"
                  disabled={webSearchQueryInvalid}
                  onClick={onExplain}
                >
                  <RefreshCw size={14} />
                  Regenerate
                </button>
              </div>
            </article>
          ) : null}

          <div className="context-disclosure">
            <span className="context-dot" />
            {webSearchEnabled && webSearchAvailable
              ? `This selection and its page context are sent for explanation. Your search query is also sent to ${
                  providerStatus?.webSearch?.providerLabel ??
                  "the configured search provider"
                }.`
              : "Only this selection and its page context are sent for explanation"}
          </div>
        </div>
      )}
    </aside>
  );
}
