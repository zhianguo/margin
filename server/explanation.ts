import {
  type ExplainRequest,
  type ExplanationResult,
  generateExplanation,
  LlmProviderError,
  type ProviderConfig
} from "./llm.js";
import {
  searchWeb,
  type WebSearchConfig,
  WebSearchError
} from "./search.js";

export interface WebSearchWarning {
  code: string;
  message: string;
}

export interface SearchAwareExplanationResult extends ExplanationResult {
  webSearchWarning?: WebSearchWarning;
}

const groundedFallbackCodes = new Set([
  "INVALID_WEB_CITATIONS",
  "UNPARSEABLE_RESPONSE",
  "OUTPUT_TRUNCATED"
]);

function withoutWebSearch(payload: ExplainRequest): ExplainRequest {
  const { webSearch: _webSearch, ...ordinaryPayload } = payload;
  return ordinaryPayload;
}

async function ordinaryExplanation(
  providerConfig: ProviderConfig,
  payload: ExplainRequest,
  warning: WebSearchWarning
): Promise<SearchAwareExplanationResult> {
  return {
    ...(await generateExplanation(
      providerConfig,
      withoutWebSearch(payload)
    )),
    webSearchWarning: warning
  };
}

export async function generateSearchAwareExplanation(
  providerConfig: ProviderConfig,
  webSearchConfig: WebSearchConfig,
  payload: ExplainRequest,
  signal?: AbortSignal
): Promise<SearchAwareExplanationResult> {
  if (!payload.webSearch) {
    return generateExplanation(providerConfig, payload);
  }

  // Avoid disclosing a query to the search provider when no explanation can
  // be generated. generateExplanation provides the normal configuration error.
  if (!providerConfig.configured) {
    return generateExplanation(providerConfig, payload);
  }

  let webGrounding;
  try {
    webGrounding = await searchWeb(
      webSearchConfig,
      payload.webSearch,
      signal
    );
    if (webGrounding.sources.length === 0) {
      throw new WebSearchError(
        "No usable web results were found. Edit the search query or broaden its freshness range.",
        "WEB_SEARCH_NO_RESULTS",
        422
      );
    }
  } catch (error) {
    if (!(error instanceof WebSearchError)) throw error;
    if (error.code === "WEB_SEARCH_ABORTED") throw error;
    return ordinaryExplanation(providerConfig, payload, {
      code: error.code,
      message: `${error.message} This explanation was generated without current web sources.`
    });
  }

  try {
    return await generateExplanation(
      providerConfig,
      payload,
      webGrounding
    );
  } catch (error) {
    if (
      !(error instanceof LlmProviderError) ||
      !groundedFallbackCodes.has(error.code)
    ) {
      throw error;
    }
    return ordinaryExplanation(providerConfig, payload, {
      code: error.code,
      message:
        "The model could not produce a reliably cited web section. This explanation was generated without current web sources."
    });
  }
}
