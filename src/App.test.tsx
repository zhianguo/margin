import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  DocumentSource,
  ExplainMode,
  ExplanationRecord,
  Highlight,
  ProviderStatus,
  WebSearchFreshness
} from "./types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const documentMocks = vi.hoisted(() => ({
  sourceFromFile: vi.fn()
}));

const explanationMocks = vi.hoisted(() => ({
  requestExplanation: vi.fn()
}));

vi.mock("./lib/documents", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/documents")>();
  return {
    ...actual,
    sourceFromFile: documentMocks.sourceFromFile
  };
});

vi.mock("./lib/explain", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/explain")>();
  return {
    ...actual,
    requestExplanation: explanationMocks.requestExplanation
  };
});

vi.mock("./components/PdfReader", () => ({
  PdfReader: ({ source }: { source: DocumentSource }) => (
    <section data-testid="pdf-reader">{source.name}</section>
  )
}));

vi.mock("./components/EmptyState", () => ({
  EmptyState: ({
    currentSource,
    onChooseFile,
    onResume,
    onCloseCurrent
  }: {
    currentSource: DocumentSource | null;
    onChooseFile: () => void;
    onResume: () => void;
    onCloseCurrent: () => void;
  }) => (
    <main className="empty-state" data-testid="home-view">
      {currentSource ? (
        <>
          <span>{currentSource.name}</span>
          <button type="button" onClick={onResume}>
            Resume reading
          </button>
          <button type="button" onClick={onCloseCurrent}>
            Close current PDF
          </button>
        </>
      ) : (
        <>
          <span>No current PDF</span>
          <button
            className="button-primary"
            type="button"
            onClick={onChooseFile}
          >
            Choose a PDF
          </button>
        </>
      )}
    </main>
  )
}));

vi.mock("./components/LibraryRail", () => ({
  LibraryRail: ({
    highlights,
    onSelectHighlight
  }: {
    highlights: Highlight[];
    onSelectHighlight: (highlight: Highlight) => void;
  }) => (
    <aside data-testid="library-rail">
      {highlights.map((highlight) => (
        <button
          key={highlight.id}
          type="button"
          onClick={() => onSelectHighlight(highlight)}
        >
          Select {highlight.text}
        </button>
      ))}
    </aside>
  )
}));

vi.mock("./components/ExplanationPanel", () => ({
  ExplanationPanel: ({
    highlight,
    mode,
    record,
    providerStatus,
    webSearchEnabled,
    webSearchQuery,
    webSearchFreshness,
    onWebSearchEnabledChange,
    onWebSearchQueryChange,
    onWebSearchFreshnessChange,
    onModeChange,
    onExplain
  }: {
    highlight: Highlight | null;
    mode: ExplainMode;
    record?: ExplanationRecord;
    providerStatus: ProviderStatus | null;
    webSearchEnabled: boolean;
    webSearchQuery: string;
    webSearchFreshness: WebSearchFreshness;
    onWebSearchEnabledChange: (enabled: boolean) => void;
    onWebSearchQueryChange: (query: string) => void;
    onWebSearchFreshnessChange: (freshness: WebSearchFreshness) => void;
    onModeChange: (mode: ExplainMode) => void;
    onExplain: () => void;
  }) => (
    <aside data-testid="explanation-panel">
      {highlight ? (
        <>
          <span data-testid="active-highlight">{highlight.text}</span>
          <span data-testid="explanation-record-status">
            {record?.status ?? "none"}
          </span>
          {record?.webSearchWarning ? (
            <span data-testid="web-search-warning">
              {record.webSearchWarning.message}
            </span>
          ) : null}
          <span data-testid="explanation-mode">{mode}</span>
          <label>
            Mock include web sources
            <input
              type="checkbox"
              checked={webSearchEnabled}
              disabled={!providerStatus?.webSearch?.configured}
              onChange={(event) =>
                onWebSearchEnabledChange(event.target.checked)
              }
            />
          </label>
          <label>
            Mock web search query
            <input
              value={webSearchQuery}
              onChange={(event) =>
                onWebSearchQueryChange(event.target.value)
              }
            />
          </label>
          <label>
            Mock web search freshness
            <select
              value={webSearchFreshness}
              onChange={(event) =>
                onWebSearchFreshnessChange(
                  event.target.value as WebSearchFreshness
                )
              }
            >
              <option value="day">day</option>
              <option value="week">week</option>
              <option value="month">month</option>
              <option value="year">year</option>
              <option value="any">any</option>
            </select>
          </label>
          <button type="button" onClick={onExplain}>
            Submit mock explanation
          </button>
          <button type="button" onClick={() => onModeChange("deep")}>
            Use mock deep mode
          </button>
        </>
      ) : null}
    </aside>
  )
}));

vi.mock("./components/SelectionPopover", () => ({
  SelectionPopover: () => null
}));

function expectWorkspaceHidden(workspace: HTMLElement) {
  expect(
    workspace.hidden ||
      workspace.getAttribute("aria-hidden") === "true" ||
      workspace.hasAttribute("inert")
  ).toBe(true);
}

function expectWorkspaceShown(workspace: HTMLElement) {
  expect(workspace.hidden).toBe(false);
  expect(workspace).not.toHaveAttribute("aria-hidden", "true");
  expect(workspace).not.toHaveAttribute("inert");
}

function storedHighlight(id: string, text: string): Highlight {
  return {
    id,
    documentId: "margin-demo-control-systems-v1",
    text,
    content: { kind: "text" },
    pages: [
      {
        pageNumber: 1,
        rects: [
          {
            x: 0.1,
            y: 0.1,
            width: 0.3,
            height: 0.04
          }
        ]
      }
    ],
    color: "amber",
    createdAt: "2026-07-28T00:00:00.000Z"
  };
}

function seedDemoHighlights(highlights: Highlight[]): void {
  window.localStorage.setItem(
    "margin:highlights:margin-demo-control-systems-v1",
    JSON.stringify(highlights)
  );
}

function providerHealth(configured = true): ProviderStatus {
  return {
    provider: "llamacpp",
    providerLabel: "Local llama.cpp",
    model: "local-model",
    aiConfigured: true,
    providerReachable: true,
    webSearch: {
      provider: configured ? "searxng" : "none",
      providerLabel: configured ? "SearXNG" : "Not configured",
      configured
    }
  };
}

function healthResponse(status: ProviderStatus) {
  return {
    ok: true,
    json: vi.fn().mockResolvedValue(status)
  };
}

function explanationResponse() {
  return {
    explanation: {
      title: "A current explanation",
      summary: "A short explanation.",
      intuition: "An intuitive explanation.",
      details: [],
      terms: [],
      equations: [],
      connections: [],
      checkQuestion: "",
      uncertainty: ""
    },
    model: "local-model",
    provider: "llamacpp" as const
  };
}

describe("home and resume navigation", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Provider is offline"))
    );
    documentMocks.sourceFromFile.mockReset();
    explanationMocks.requestExplanation.mockReset();
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.history.replaceState(null, "", "/");
  });

  it("keeps the active reader mounted while Home is open and restores it on Resume", async () => {
    window.history.replaceState(null, "", "/?demo=1");

    render(<App />);

    const reader = screen.getByTestId("pdf-reader");
    const workspace = reader.closest<HTMLElement>(".reader-workspace");
    expect(workspace).not.toBeNull();
    reader.dataset.sessionMarker = "preserved";

    fireEvent.click(screen.getByRole("button", { name: "Margin home" }));

    expect(await screen.findByTestId("home-view")).toHaveTextContent(
      "Stability Margins in Feedback Systems"
    );
    expect(screen.getByTestId("pdf-reader")).toBe(reader);
    expectWorkspaceHidden(workspace!);

    fireEvent.click(screen.getByRole("button", { name: /resume reading/i }));

    await waitFor(() =>
      expect(screen.queryByTestId("home-view")).not.toBeInTheDocument()
    );
    expect(screen.getByTestId("pdf-reader")).toBe(reader);
    expect(screen.getByTestId("pdf-reader")).toHaveAttribute(
      "data-session-marker",
      "preserved"
    );
    expectWorkspaceShown(workspace!);
  });

  it("releases a local PDF only when Close current PDF is chosen", async () => {
    const localSource: DocumentSource = {
      id: "local-paper-id",
      name: "local-paper",
      url: "blob:local-paper"
    };
    documentMocks.sourceFromFile.mockResolvedValue(localSource);
    const revokeObjectUrl = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => undefined);

    render(<App />);

    const input = document.querySelector<HTMLInputElement>(
      'input[type="file"]'
    );
    expect(input).not.toBeNull();
    fireEvent.change(input!, {
      target: {
        files: [
          new File(["%PDF-1.7"], "local-paper.pdf", {
            type: "application/pdf"
          })
        ]
      }
    });

    expect(await screen.findByTestId("pdf-reader")).toHaveTextContent(
      "local-paper"
    );
    revokeObjectUrl.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Margin home" }));

    expect(await screen.findByRole("button", { name: /close current pdf/i }))
      .toBeInTheDocument();
    expect(screen.getByTestId("pdf-reader")).toBeInTheDocument();
    expect(revokeObjectUrl).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: /close current pdf/i })
    );

    await waitFor(() =>
      expect(screen.queryByTestId("pdf-reader")).not.toBeInTheDocument()
    );
    expect(screen.getByTestId("home-view")).toHaveTextContent("No current PDF");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Choose a PDF" })
      ).toHaveFocus()
    );
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:local-paper");
  });
});

describe("web search request state", () => {
  beforeEach(() => {
    documentMocks.sourceFromFile.mockReset();
    explanationMocks.requestExplanation.mockReset();
    explanationMocks.requestExplanation.mockResolvedValue(
      explanationResponse()
    );
    window.localStorage.clear();
    window.history.replaceState(null, "", "/?demo=1");
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.history.replaceState(null, "", "/");
  });

  it("trims the query, sends freshness, and omits search after opt-out", async () => {
    const passage = storedHighlight(
      "highlight-one",
      "The damping ratio controls transient response."
    );
    seedDemoHighlights([passage]);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(healthResponse(providerHealth()))
    );

    render(<App />);
    fireEvent.click(
      screen.getByRole("button", { name: `Select ${passage.text}` })
    );

    const checkbox = screen.getByRole("checkbox", {
      name: "Mock include web sources"
    });
    await waitFor(() => expect(checkbox).not.toBeDisabled());
    expect(screen.getByLabelText("Mock web search query")).toHaveValue(
      `Stability Margins in Feedback Systems ${passage.text}`
    );

    fireEvent.click(checkbox);
    fireEvent.change(screen.getByLabelText("Mock web search query"), {
      target: { value: "  newest damping research  " }
    });
    fireEvent.change(screen.getByLabelText("Mock web search freshness"), {
      target: { value: "week" }
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Submit mock explanation" })
    );

    await waitFor(() =>
      expect(explanationMocks.requestExplanation).toHaveBeenCalledOnce()
    );
    expect(explanationMocks.requestExplanation.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        webSearch: {
          query: "newest damping research",
          freshness: "week"
        }
      })
    );
    await waitFor(() =>
      expect(screen.getByTestId("explanation-record-status")).toHaveTextContent(
        "success"
      )
    );

    fireEvent.click(checkbox);
    fireEvent.click(
      screen.getByRole("button", { name: "Submit mock explanation" })
    );

    await waitFor(() =>
      expect(explanationMocks.requestExplanation).toHaveBeenCalledTimes(2)
    );
    expect(
      explanationMocks.requestExplanation.mock.calls[1]?.[0]
    ).not.toHaveProperty("webSearch");
  });

  it("resets search opt-in and derives a new query when the highlight changes", async () => {
    const first = storedHighlight("highlight-one", "First passage");
    const second = storedHighlight("highlight-two", "Second passage");
    seedDemoHighlights([first, second]);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(healthResponse(providerHealth()))
    );

    render(<App />);
    fireEvent.click(
      screen.getByRole("button", { name: `Select ${first.text}` })
    );

    const checkbox = screen.getByRole("checkbox", {
      name: "Mock include web sources"
    });
    await waitFor(() => expect(checkbox).not.toBeDisabled());
    fireEvent.click(checkbox);
    fireEvent.change(screen.getByLabelText("Mock web search query"), {
      target: { value: "my private edited query" }
    });
    expect(checkbox).toBeChecked();

    fireEvent.click(
      screen.getByRole("button", { name: `Select ${second.text}` })
    );

    await waitFor(() => expect(checkbox).not.toBeChecked());
    expect(screen.getByLabelText("Mock web search query")).toHaveValue(
      `Stability Margins in Feedback Systems ${second.text}`
    );
  });

  it("clears search opt-in when health reports that the provider became unavailable", async () => {
    const passage = storedHighlight("highlight-one", "First passage");
    seedDemoHighlights([passage]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(healthResponse(providerHealth()))
      .mockResolvedValue(healthResponse(providerHealth(false)));
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    fireEvent.click(
      screen.getByRole("button", { name: `Select ${passage.text}` })
    );

    const checkbox = screen.getByRole("checkbox", {
      name: "Mock include web sources"
    });
    await waitFor(() => expect(checkbox).not.toBeDisabled());
    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();

    window.dispatchEvent(new Event("focus"));
    await waitFor(() => {
      expect(checkbox).not.toBeChecked();
      expect(checkbox).toBeDisabled();
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Submit mock explanation" })
    );
    await waitFor(() =>
      expect(explanationMocks.requestExplanation).toHaveBeenCalledOnce()
    );
    expect(
      explanationMocks.requestExplanation.mock.calls[0]?.[0]
    ).not.toHaveProperty("webSearch");
  });

  it("reuses the current search settings when a new explanation mode is generated", async () => {
    const passage = storedHighlight("highlight-one", "First passage");
    seedDemoHighlights([passage]);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(healthResponse(providerHealth()))
    );

    render(<App />);
    fireEvent.click(
      screen.getByRole("button", { name: `Select ${passage.text}` })
    );

    const checkbox = screen.getByRole("checkbox", {
      name: "Mock include web sources"
    });
    await waitFor(() => expect(checkbox).not.toBeDisabled());
    fireEvent.click(checkbox);
    fireEvent.change(screen.getByLabelText("Mock web search query"), {
      target: { value: "current control research" }
    });
    fireEvent.change(screen.getByLabelText("Mock web search freshness"), {
      target: { value: "year" }
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Submit mock explanation" })
    );
    await waitFor(() =>
      expect(screen.getByTestId("explanation-record-status")).toHaveTextContent(
        "success"
      )
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Use mock deep mode" })
    );

    await waitFor(() =>
      expect(explanationMocks.requestExplanation).toHaveBeenCalledTimes(2)
    );
    expect(explanationMocks.requestExplanation.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        mode: "deep",
        webSearch: {
          query: "current control research",
          freshness: "year"
        }
      })
    );
  });

  it("keeps a fallback explanation successful and records its search warning", async () => {
    const passage = storedHighlight("highlight-one", "First passage");
    seedDemoHighlights([passage]);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(healthResponse(providerHealth()))
    );
    explanationMocks.requestExplanation.mockResolvedValue({
      ...explanationResponse(),
      webSearchWarning: {
        code: "WEB_SEARCH_NO_RESULTS",
        message:
          "No usable web results were found. This explanation was generated without current web sources."
      }
    });

    render(<App />);
    fireEvent.click(
      screen.getByRole("button", { name: `Select ${passage.text}` })
    );
    const checkbox = screen.getByRole("checkbox", {
      name: "Mock include web sources"
    });
    await waitFor(() => expect(checkbox).not.toBeDisabled());
    fireEvent.click(checkbox);
    fireEvent.click(
      screen.getByRole("button", { name: "Submit mock explanation" })
    );

    await waitFor(() =>
      expect(screen.getByTestId("explanation-record-status")).toHaveTextContent(
        "success"
      )
    );
    expect(screen.getByTestId("web-search-warning")).toHaveTextContent(
      "generated without current web sources"
    );
  });

});
