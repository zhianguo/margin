import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  Explanation,
  ExplanationRecord,
  Highlight,
  LlmProvider,
  ProviderStatus
} from "../types";
import { ExplanationPanel } from "./ExplanationPanel";

const highlight: Highlight = {
  id: "highlight-1",
  documentId: "document-1",
  text: "The damping ratio controls the transient response.",
  content: { kind: "text" },
  pages: [{ pageNumber: 1, rects: [] }],
  color: "amber",
  createdAt: "2026-07-24T00:00:00.000Z"
};

const providerStatus: ProviderStatus = {
  provider: "llamacpp",
  providerLabel: "Local llama.cpp",
  model: "local-model",
  aiConfigured: true,
  providerReachable: true
};

const searchableProviderStatus: ProviderStatus = {
  ...providerStatus,
  webSearch: {
    provider: "searxng",
    providerLabel: "SearXNG",
    configured: true
  }
};

afterEach(cleanup);

function explanationRecord(
  overrides: Partial<Explanation> = {}
): ExplanationRecord {
  return {
    highlightId: highlight.id,
    mode: "equation",
    status: "success",
    model: "local-model",
    provider: "llamacpp",
    data: {
      title: "$H_\\infty$ robustness",
      summary: "The response depends on $\\zeta$ and $\\omega_n$.",
      intuition: "Think of $\\zeta$ as a brake.",
      details: [],
      terms: [
        {
          term: "$L(j\\omega)$",
          meaning: "The loop gain at angular frequency $\\omega$."
        }
      ],
      equations: [
        {
          expression:
            "\\[\\frac{\\omega_n^2}{s^2 + 2\\zeta\\omega_n s + \\omega_n^2}\\]",
          interpretation: "A canonical second-order transfer function."
        }
      ],
      connections: [],
      checkQuestion: "",
      uncertainty: "",
      ...overrides
    }
  };
}

function credentialBearingUrl(): string {
  const url = new URL("https://private.example/result");
  url.username = "reader";
  url.password = "token";
  return url.toString();
}

function webExplanationRecord(): ExplanationRecord {
  return {
    ...explanationRecord(),
    webContext: {
      query: "recent damping ratio research",
      searchedAt: "2026-07-28T19:30:00.000Z",
      freshness: "week",
      summary:
        "Recent sources discuss $\\zeta$ in updated control-system designs.",
      claims: [
        {
          text: "The latest design guidance still treats $\\zeta$ as central.",
          sourceIds: ["source-1", "missing-source", "source-1", "source-3"]
        },
        {
          text: "This claim has no matching source.",
          sourceIds: ["missing-source"]
        }
      ],
      sources: [
        {
          id: "source-1",
          title: "Updated damping guidance",
          url: "https://research.example/update",
          snippet: "This search-result snippet must remain hidden.",
          publishedAt: "2026-07-27"
        },
        {
          id: "unsafe-source",
          title: "Unsafe source",
          url: "javascript:alert('unsafe')",
          snippet: "Unsafe content"
        },
        {
          id: "credential-source",
          title: "Credential-bearing source",
          url: credentialBearingUrl(),
          snippet: "Credentials must not be copied into a link."
        },
        {
          id: "source-3",
          title: "Control systems review",
          url: "https://news.example/control-review",
          snippet: "Another hidden snippet."
        }
      ]
    }
  };
}

function renderPanel(
  record = explanationRecord(),
  selectedHighlight = highlight,
  overrides: Partial<ComponentProps<typeof ExplanationPanel>> = {}
) {
  return render(
    <ExplanationPanel
      highlight={selectedHighlight}
      mode="equation"
      record={record}
      providerStatus={providerStatus}
      webSearchEnabled={false}
      webSearchQuery=""
      webSearchFreshness="any"
      onModeChange={vi.fn()}
      onWebSearchEnabledChange={vi.fn()}
      onWebSearchQueryChange={vi.fn()}
      onWebSearchFreshnessChange={vi.fn()}
      onExplain={vi.fn()}
      onRecognizeFormula={vi.fn()}
      onExplainWithExtractedText={vi.fn()}
      onSaveFormulaLatex={vi.fn()}
      onResetFormulaLatex={vi.fn()}
      onTreatAsDiagram={vi.fn()}
      onTreatAsText={vi.fn()}
      onDelete={vi.fn()}
      onClose={vi.fn()}
      {...overrides}
    />
  );
}

describe("ExplanationPanel math rendering", () => {
  it("shows a faithful diagram preview without formula OCR controls", () => {
    const onTreatAsText = vi.fn();
    const storedPreview = "data:image/png;base64,STORED";
    const renderedPreview = "data:image/png;base64,RENDERED";
    const diagramHighlight: Highlight = {
      ...highlight,
      text: "Q −−−−→ Qp x \uF8E6 \uF8E6 x \uF8E6 \uF8E6 Q −−−−→ Qp",
      content: {
        kind: "diagram",
        region: {
          pageNumber: 11,
          x: 0.2,
          y: 0.24,
          width: 0.6,
          height: 0.07
        },
        previewImage: storedPreview,
        layoutText: "Q̄  −−−−→  Q̄ₚ\n↑             ↑\nQ   −−−−→  Qₚ"
      },
      pages: [{ pageNumber: 11, rects: [] }]
    };

    renderPanel(explanationRecord(), diagramHighlight, {
      visualPreviewImage: renderedPreview,
      formulaRecognition: {
        highlightId: diagramHighlight.id,
        status: "error",
        error: "OCR should not be used for a diagram."
      },
      onTreatAsText
    });

    expect(screen.getByText(/Selected diagram/)).toBeInTheDocument();
    expect(screen.getByText("Faithful page image")).toBeInTheDocument();
    expect(
      screen.getByRole("img", {
        name: /Selected diagram from page 11, shown as a faithful image/
      })
    ).toHaveAttribute("src", renderedPreview);
    const extracted = screen
      .getByText("Approximate layout and extracted text")
      .closest("details");
    expect(extracted).not.toHaveAttribute("open");
    expect(screen.getByLabelText("Approximate diagram layout")).toHaveTextContent(
      "Q̄"
    );
    expect(screen.queryByText("Formula transcription unavailable")).toBeNull();
    expect(screen.queryByText("Enter LaTeX manually")).toBeNull();
    expect(screen.queryByText("Retry formula OCR")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Treat as text" }));
    expect(onTreatAsText).toHaveBeenCalledOnce();
  });

  it("falls back to a diagram's stored preview image", () => {
    const storedPreview = "data:image/png;base64,STORED";
    const diagramHighlight: Highlight = {
      ...highlight,
      content: {
        kind: "diagram",
        region: {
          pageNumber: 11,
          x: 0.2,
          y: 0.24,
          width: 0.6,
          height: 0.07
        },
        previewImage: storedPreview
      },
      pages: [{ pageNumber: 11, rects: [] }]
    };

    renderPanel(explanationRecord(), diagramHighlight);

    expect(
      screen.getByRole("img", { name: /Selected diagram from page 11/ })
    ).toHaveAttribute("src", storedPreview);
  });

  it("offers diagram treatment only for eligible text selections", () => {
    const onTreatAsDiagram = vi.fn();
    const { rerender } = renderPanel(explanationRecord(), highlight, {
      canTreatAsDiagram: true,
      onTreatAsDiagram
    });

    fireEvent.click(screen.getByRole("button", { name: "Treat as diagram" }));
    expect(onTreatAsDiagram).toHaveBeenCalledOnce();

    rerender(
      <ExplanationPanel
        highlight={highlight}
        mode="equation"
        record={explanationRecord()}
        providerStatus={providerStatus}
        canTreatAsDiagram={false}
        webSearchEnabled={false}
        webSearchQuery=""
        webSearchFreshness="any"
        onModeChange={vi.fn()}
        onWebSearchEnabledChange={vi.fn()}
        onWebSearchQueryChange={vi.fn()}
        onWebSearchFreshnessChange={vi.fn()}
        onExplain={vi.fn()}
        onRecognizeFormula={vi.fn()}
        onExplainWithExtractedText={vi.fn()}
        onSaveFormulaLatex={vi.fn()}
        onResetFormulaLatex={vi.fn()}
        onTreatAsDiagram={onTreatAsDiagram}
        onTreatAsText={vi.fn()}
        onDelete={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.queryByRole("button", { name: "Treat as diagram" })).toBeNull();
  });

  it("shows a rendered-page snapshot for a formula with unreliable OCR", () => {
    const formulaPreview = "data:image/png;base64,AAAA";
    const formulaHighlight: Highlight = {
      ...highlight,
      text: "L(s,x) = u^-x(p)p-r1",
      content: { kind: "formula", previewImage: formulaPreview },
      pages: [{ pageNumber: 5, rects: [] }]
    };

    renderPanel(explanationRecord(), formulaHighlight);

    expect(
      screen.getByRole("img", { name: /Selected formula image from page 5/ })
    ).toHaveAttribute("src", formulaPreview);
    expect(
      screen.getByText("Extracted text (may be inaccurate)")
    ).toBeInTheDocument();
    expect(screen.getByText(/L\(s,x\) = u/)).toBeInTheDocument();
  });

  it("renders recognized formula notation and marks it for verification", () => {
    const formulaHighlight: Highlight = {
      ...highlight,
      text: "L(s,o)=R(det[l",
      content: {
        kind: "formula",
        previewImage: "data:image/png;base64,AAAA",
        notation: {
          recognizedLatex:
            "L(s,\\sigma)=\\prod_p\\det(I_n-\\sigma(\\mathrm{Fr}_p)p^{-s})^{-1}"
        }
      },
      pages: [{ pageNumber: 5, rects: [] }]
    };

    const { container } = renderPanel(explanationRecord(), formulaHighlight);

    expect(screen.getByText("Machine recognized—verify")).toBeInTheDocument();
    expect(
      container.querySelector(".formula-transcription-preview .katex")
    ).not.toBeNull();
  });

  it("saves a validated user correction", () => {
    const onSaveFormulaLatex = vi.fn();
    const formulaHighlight: Highlight = {
      ...highlight,
      text: "L(s,o)",
      content: {
        kind: "formula",
        previewImage: "data:image/png;base64,AAAA",
        notation: { recognizedLatex: "L(s,o)" }
      }
    };
    renderPanel(explanationRecord(), formulaHighlight, {
      onSaveFormulaLatex
    });

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Formula LaTeX"), {
      target: { value: "$L(s,\\sigma)$" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save notation" }));

    expect(onSaveFormulaLatex).toHaveBeenCalledWith("L(s,\\sigma)");
  });

  it("preserves a manual draft when OCR finishes in the background", () => {
    const formulaHighlight: Highlight = {
      ...highlight,
      text: "L(s,o)",
      content: {
        kind: "formula",
        previewImage: "data:image/png;base64,AAAA"
      }
    };
    const props: ComponentProps<typeof ExplanationPanel> = {
      highlight: formulaHighlight,
      mode: "equation",
      providerStatus,
      webSearchEnabled: false,
      webSearchQuery: "",
      webSearchFreshness: "any",
      onModeChange: vi.fn(),
      onWebSearchEnabledChange: vi.fn(),
      onWebSearchQueryChange: vi.fn(),
      onWebSearchFreshnessChange: vi.fn(),
      onExplain: vi.fn(),
      onRecognizeFormula: vi.fn(),
      onExplainWithExtractedText: vi.fn(),
      onSaveFormulaLatex: vi.fn(),
      onResetFormulaLatex: vi.fn(),
      onTreatAsDiagram: vi.fn(),
      onTreatAsText: vi.fn(),
      onDelete: vi.fn(),
      onClose: vi.fn()
    };
    const { rerender } = render(<ExplanationPanel {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Enter LaTeX manually" }));
    fireEvent.change(screen.getByLabelText("Formula LaTeX"), {
      target: { value: "L(s,\\rho)" }
    });
    rerender(
      <ExplanationPanel
        {...props}
        highlight={{
          ...formulaHighlight,
          content: {
            kind: "formula",
            previewImage: "data:image/png;base64,AAAA",
            notation: { recognizedLatex: "L(s,\\sigma)" }
          }
        }}
      />
    );

    expect(screen.getByLabelText("Formula LaTeX")).toHaveValue("L(s,\\rho)");
  });

  it("requires an explicit action after formula OCR fails", () => {
    const onRecognizeFormula = vi.fn();
    const onExplainWithExtractedText = vi.fn();
    const formulaHighlight: Highlight = {
      ...highlight,
      text: "L(s,o)",
      content: {
        kind: "formula",
        previewImage: "data:image/png;base64,AAAA"
      }
    };
    renderPanel(explanationRecord(), formulaHighlight, {
      record: undefined,
      formulaRecognition: {
        highlightId: formulaHighlight.id,
        status: "error",
        error: "Could not reach Formula OCR."
      },
      onRecognizeFormula,
      onExplainWithExtractedText
    });

    expect(screen.queryByText("Explain this passage")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry formula OCR" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Explain with extracted text" })
    );
    expect(onRecognizeFormula).toHaveBeenCalledOnce();
    expect(onExplainWithExtractedText).toHaveBeenCalledOnce();
  });

  it.each(
    [
      ["openai", ".env.example"],
      ["llamacpp", ".env.llamacpp.example"],
      ["gemini", ".env.gemini.example"],
      ["openai-compatible", ".env.openai-compatible.example"]
    ] satisfies Array<[LlmProvider, string]>
  )(
    "points an unconfigured %s provider to its environment example",
    (provider, environmentExample) => {
      const record: ExplanationRecord = {
        highlightId: highlight.id,
        mode: "plain",
        status: "error",
        error: "The selected LLM provider is not configured.",
        errorCode: "MISSING_PROVIDER_CONFIG"
      };

      renderPanel(record, highlight, {
        providerStatus: {
          ...providerStatus,
          provider,
          providerLabel: provider,
          aiConfigured: false
        }
      });

      expect(
        screen.getByText(`cp ${environmentExample} .env`)
      ).toBeInTheDocument();
    }
  );

  it("renders math in headings, term names, prose, and display equations", () => {
    const { container } = renderPanel();

    expect(container.querySelector(".answer-heading h3 .katex")).not.toBeNull();
    expect(screen.getByText("The short version")).toHaveClass("answer-kicker");
    expect(
      container.querySelector(".answer-heading h3 .answer-kicker")
    ).toBeNull();
    expect(container.querySelector(".term-list dt .katex")).not.toBeNull();
    expect(container.querySelector(".answer-summary .katex")).not.toBeNull();
    expect(
      container.querySelector(".equation-expression .katex-display")
    ).not.toBeNull();
    expect(container.querySelector(".katex-error")).toBeNull();
  });

  it("keeps malformed equations readable without exposing a KaTeX error", () => {
    const record = explanationRecord({
      equations: [
        {
          expression: "\\notARealCommand{",
          interpretation: "The model supplied malformed notation."
        }
      ]
    });
    const { container } = renderPanel(record);

    expect(container.querySelector(".katex-error")).toBeNull();
    expect(container.querySelector(".math-fallback")).toHaveTextContent(
      "\\notARealCommand{"
    );
    expect(
      screen.getByText("The model supplied malformed notation.")
    ).toBeInTheDocument();
  });
});

describe("ExplanationPanel web search", () => {
  it("disables opt-in when no web search provider is configured", () => {
    renderPanel();

    expect(
      screen.getByRole("checkbox", { name: "Include current web sources" })
    ).toBeDisabled();
    expect(
      screen.getByText(
        "Web search is not configured. Configure a search provider to include current sources."
      )
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Search query")).toBeNull();
  });

  it("shows an unavailable provider's configuration explanation", () => {
    renderPanel(explanationRecord(), highlight, {
      providerStatus: {
        ...providerStatus,
        webSearch: {
          provider: "searxng",
          providerLabel: "SearXNG",
          configured: false,
          configurationError: "Set WEB_SEARCH_URL before starting Margin."
        }
      }
    });

    expect(
      screen.getByRole("checkbox", { name: "Include current web sources" })
    ).toBeDisabled();
    expect(
      screen.getByText(
        "Web search is not configured. Set WEB_SEARCH_URL before starting Margin."
      )
    ).toBeInTheDocument();
  });

  it("renders controlled query controls and reports changes without submitting", () => {
    const onWebSearchEnabledChange = vi.fn();
    const onWebSearchQueryChange = vi.fn();
    const onWebSearchFreshnessChange = vi.fn();
    const onExplain = vi.fn();

    renderPanel(explanationRecord(), highlight, {
      providerStatus: searchableProviderStatus,
      webSearchEnabled: true,
      webSearchQuery: "current damping guidance",
      webSearchFreshness: "week",
      onWebSearchEnabledChange,
      onWebSearchQueryChange,
      onWebSearchFreshnessChange,
      onExplain
    });

    const checkbox = screen.getByRole("checkbox", {
      name: "Include current web sources"
    });
    const query = screen.getByLabelText("Search query");
    const freshness = screen.getByLabelText("Freshness");

    expect(checkbox).toBeChecked();
    expect(query).toHaveValue("current damping guidance");
    expect(query).toHaveAttribute("maxlength", "300");
    expect(freshness).toHaveValue("week");
    expect(
      screen.getByText("The query below goes to SearXNG.")
    ).toBeInTheDocument();

    fireEvent.change(query, { target: { value: "new research" } });
    fireEvent.change(freshness, { target: { value: "month" } });
    fireEvent.click(checkbox);

    expect(onWebSearchQueryChange).toHaveBeenCalledWith("new research");
    expect(onWebSearchFreshnessChange).toHaveBeenCalledWith("month");
    expect(onWebSearchEnabledChange).toHaveBeenCalledWith(false);
    expect(onExplain).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        "This selection and its page context are sent for explanation. Your search query is also sent to SearXNG."
      )
    ).toBeInTheDocument();
  });

  it.each([
    ["idle", "Explain this passage"],
    ["error", "Try again"],
    ["success", "Regenerate"]
  ] as const)(
    "blocks the %s explanation action until the search query is valid",
    (status, actionName) => {
      const onExplain = vi.fn();
      const record: ExplanationRecord =
        status === "success"
          ? explanationRecord()
          : {
              highlightId: highlight.id,
              mode: "plain",
              status,
              error:
                status === "error" ? "The previous request failed." : undefined
            };

      renderPanel(record, highlight, {
        providerStatus: searchableProviderStatus,
        webSearchEnabled: true,
        webSearchQuery: " ",
        onExplain
      });

      expect(
        screen.getByText("Enter at least 2 characters to search the web.")
      ).toBeInTheDocument();
      const action = screen.getByRole("button", { name: actionName });
      expect(action).toBeDisabled();
      fireEvent.click(action);
      expect(onExplain).not.toHaveBeenCalled();
    }
  );

  it("disables formula fallback actions instead of silently ignoring an invalid search query", () => {
    const onRecognizeFormula = vi.fn();
    const onExplainWithExtractedText = vi.fn();
    const formulaHighlight: Highlight = {
      ...highlight,
      text: "L(s,o)",
      content: {
        kind: "formula",
        previewImage: "data:image/png;base64,AAAA"
      }
    };
    renderPanel(explanationRecord(), formulaHighlight, {
      record: undefined,
      providerStatus: searchableProviderStatus,
      webSearchEnabled: true,
      webSearchQuery: " ",
      formulaRecognition: {
        highlightId: formulaHighlight.id,
        status: "error",
        error: "Could not reach Formula OCR."
      },
      onRecognizeFormula,
      onExplainWithExtractedText
    });

    const retry = screen.getByRole("button", { name: "Retry formula OCR" });
    const extracted = screen.getByRole("button", {
      name: "Explain with extracted text"
    });
    expect(retry).toBeDisabled();
    expect(extracted).toBeDisabled();
    fireEvent.click(retry);
    fireEvent.click(extracted);
    expect(onRecognizeFormula).not.toHaveBeenCalled();
    expect(onExplainWithExtractedText).not.toHaveBeenCalled();
  });

  it.each([
    [
      "WEB_SEARCH_NO_RESULTS",
      "No usable results were found. This explanation was generated without current web sources.",
      "No current web results"
    ],
    [
      "WEB_SEARCH_TIMEOUT",
      "The search provider timed out. This explanation was generated without current web sources.",
      "Current web sources unavailable"
    ]
  ])(
    "keeps a normal explanation visible with a non-fatal %s warning",
    (code, message, heading) => {
      renderPanel(
        {
          ...explanationRecord(),
          webSearchWarning: { code, message }
        },
        highlight,
        {
          providerStatus: searchableProviderStatus,
          webSearchEnabled: true,
          webSearchQuery: "current damping research",
          webSearchFreshness: "month"
        }
      );

      expect(screen.getByText("The short version")).toBeInTheDocument();
      expect(screen.getByText(heading)).toBeInTheDocument();
      expect(screen.getByText(message)).toBeInTheDocument();
      expect(screen.queryByText("Latest from the web")).toBeNull();
      expect(
        screen.queryByText(
          "Search settings changed. Regenerate to update this explanation."
        )
      ).toBeNull();
    }
  );

  it("shows which recorded query produced web context after controls change", () => {
    renderPanel(webExplanationRecord(), highlight, {
      providerStatus: searchableProviderStatus,
      webSearchEnabled: true,
      webSearchQuery: "an unsent edited query",
      webSearchFreshness: "week"
    });

    expect(
      screen.getByText("recent damping ratio research")
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Search settings changed. Regenerate to update this explanation."
      )
    ).toBeInTheDocument();
  });

  it("renders only matched, safe citations and source metadata", () => {
    renderPanel(webExplanationRecord(), highlight, {
      providerStatus: searchableProviderStatus
    });

    expect(screen.getByText("Latest from the web")).toBeInTheDocument();
    expect(screen.getByText("As of Jul 28, 2026")).toBeInTheDocument();
    expect(screen.getByText("Updated damping guidance")).toBeInTheDocument();
    expect(screen.getByText("research.example · Jul 27, 2026")).toBeInTheDocument();
    expect(screen.getByText("news.example")).toBeInTheDocument();
    expect(
      screen.getByText("recent damping ratio research")
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Web search is off. Regenerate to remove the existing web context."
      )
    ).toBeInTheDocument();
    expect(
      screen.queryByText("This search-result snippet must remain hidden.")
    ).toBeNull();
    expect(screen.queryByText("Unsafe source")).toBeNull();
    expect(screen.queryByText("Credential-bearing source")).toBeNull();

    const sourceOneCitation = screen.getByRole("link", {
      name: "Source 1: Updated damping guidance"
    });
    const sourceTwoCitation = screen.getByRole("link", {
      name: "Source 2: Control systems review"
    });
    expect(sourceOneCitation).toHaveTextContent("[1]");
    expect(sourceTwoCitation).toHaveTextContent("[2]");

    const unsupportedClaim = screen
      .getByText("This claim has no matching source.")
      .closest("li");
    expect(unsupportedClaim).not.toBeNull();
    expect(within(unsupportedClaim!).queryByRole("link")).toBeNull();

    for (const link of screen.getAllByRole("link")) {
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
      expect(link.getAttribute("href")).toMatch(/^https:\/\//);
    }
  });

  it("includes the web summary, claims, citations, and source URLs when copied", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });
    renderPanel(webExplanationRecord(), highlight, {
      providerStatus: searchableProviderStatus
    });

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    const copiedText = writeText.mock.calls[0]?.[0] as string;
    expect(copiedText).toContain("Latest from the web");
    expect(copiedText).toContain("Search query: recent damping ratio research");
    expect(copiedText).toContain(
      "The latest design guidance still treats $\\zeta$ as central. [1] [2]"
    );
    expect(copiedText).toContain("https://research.example/update");
    expect(copiedText).toContain("https://news.example/control-review");
    expect(copiedText).not.toContain("javascript:");
    expect(copiedText).not.toContain("reader:token");
  });
});
