export type ExplainMode = "plain" | "deep" | "equation";
export type LlmProvider =
  | "openai"
  | "llamacpp"
  | "gemini"
  | "openai-compatible";

export interface FormulaRecognitionStatus {
  configured: boolean;
  reachable: boolean | null;
  label: string;
  model?: string;
  configurationError?: string;
}

export interface ProviderStatus {
  provider: LlmProvider;
  providerLabel: string;
  model: string;
  aiConfigured: boolean;
  providerReachable: boolean | null;
  configurationError?: string;
  formulaRecognition?: FormulaRecognitionStatus;
}

export interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface HighlightPage {
  pageNumber: number;
  rects: NormalizedRect[];
}

export interface PdfVisualRegion extends NormalizedRect {
  pageNumber: number;
}

// Kept as a source-compatible alias while formula crop callers move to the
// generic visual-selection terminology.
export type FormulaRegion = PdfVisualRegion;

export interface FormulaNotation {
  recognizedLatex?: string;
  correctedLatex?: string;
}

export interface TextSelectionContent {
  kind: "text";
}

export interface FormulaSelectionContent {
  kind: "formula";
  region?: PdfVisualRegion;
  previewImage?: string;
  notation?: FormulaNotation;
}

export interface DiagramSelectionContent {
  kind: "diagram";
  region: PdfVisualRegion;
  previewImage?: string;
  layoutText?: string;
}

export type HighlightContent =
  | TextSelectionContent
  | FormulaSelectionContent
  | DiagramSelectionContent;

export interface Highlight {
  id: string;
  documentId: string;
  text: string;
  content: HighlightContent;
  pages: HighlightPage[];
  color: "amber" | "sage" | "rose";
  createdAt: string;
}

export interface CapturedSelection {
  text: string;
  pageNumber: number;
  pages: HighlightPage[];
  content: HighlightContent;
  geometryRepaired?: boolean;
  viewportAnchor: {
    left: number;
    top: number;
    bottom: number;
  };
}

export interface DocumentSource {
  id: string;
  name: string;
  url: string;
  size?: number;
  isDemo?: boolean;
}

export interface ExplanationTerm {
  term: string;
  meaning: string;
}

export interface ExplanationEquation {
  expression: string;
  interpretation: string;
}

export interface Explanation {
  title: string;
  summary: string;
  intuition: string;
  details: string[];
  terms: ExplanationTerm[];
  equations: ExplanationEquation[];
  connections: string[];
  checkQuestion: string;
  uncertainty: string;
}

export interface ExplanationRecord {
  highlightId: string;
  mode: ExplainMode;
  status: "idle" | "loading" | "success" | "error";
  data?: Explanation;
  error?: string;
  errorCode?: string;
  model?: string;
  provider?: LlmProvider;
}
