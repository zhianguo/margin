export interface FormulaRecognitionResponse {
  latex: string;
  model?: string;
}

export interface FormulaRecognitionState {
  highlightId: string;
  status: "idle" | "loading" | "error";
  error?: string;
  errorCode?: string;
}

export class FormulaRecognitionApiError extends Error {
  code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "FormulaRecognitionApiError";
    this.code = code;
  }
}

export function formulaImageDataUrlToBlob(value: string): Blob | null {
  const match = value.match(
    /^data:(image\/(?:png|webp|jpeg));base64,([A-Za-z0-9+/=\s]+)$/i
  );
  if (!match) return null;

  try {
    const binary = atob(match[2].replace(/\s+/g, ""));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new Blob([bytes], { type: match[1].toLowerCase() });
  } catch {
    return null;
  }
}

export async function requestFormulaRecognition(
  image: Blob,
  signal?: AbortSignal
): Promise<FormulaRecognitionResponse> {
  const response = await fetch("/api/formula/recognize", {
    method: "POST",
    headers: {
      "Content-Type": image.type || "image/png",
      Accept: "application/json"
    },
    body: image,
    signal
  });

  const body = (await response.json().catch(() => null)) as
    | (Partial<FormulaRecognitionResponse> & {
        error?: string;
        code?: string;
      })
    | null;

  if (!response.ok || !body) {
    throw new FormulaRecognitionApiError(
      body?.error || "The formula recognition service did not respond.",
      body?.code
    );
  }

  if (
    typeof body.latex !== "string" ||
    body.latex.trim().length === 0 ||
    body.latex.length > 4_096
  ) {
    throw new FormulaRecognitionApiError(
      "The formula recognition service returned invalid notation.",
      "INVALID_FORMULA_RESPONSE"
    );
  }

  return {
    latex: body.latex,
    ...(typeof body.model === "string" && body.model.length <= 200
      ? { model: body.model }
      : {})
  };
}
