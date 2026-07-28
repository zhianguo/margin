import type {
  ExplainMode,
  Explanation,
  LlmProvider
} from "../types";

interface ExplainPayload {
  selectedText: string;
  selectedFormulaLatex?: string;
  visualContext?: {
    kind: "diagram";
    layoutText?: string;
  };
  pageContext: string;
  pageNumber: number;
  documentTitle: string;
  mode: ExplainMode;
}

interface ExplainResponse {
  explanation: Explanation;
  model: string;
  provider: LlmProvider;
}

export class ExplainApiError extends Error {
  code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "ExplainApiError";
    this.code = code;
  }
}

export async function requestExplanation(
  payload: ExplainPayload,
  signal?: AbortSignal
): Promise<ExplainResponse> {
  const response = await fetch("/api/explain", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal
  });

  const body = (await response.json().catch(() => null)) as
    | (ExplainResponse & { error?: string; code?: string })
    | null;

  if (!response.ok || !body) {
    throw new ExplainApiError(
      body?.error || "The explanation service did not respond.",
      body?.code
    );
  }

  return body;
}
