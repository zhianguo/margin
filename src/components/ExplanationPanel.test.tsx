import {
  cleanup,
  fireEvent,
  render,
  screen
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
      onModeChange={vi.fn()}
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
        onModeChange={vi.fn()}
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
      onModeChange: vi.fn(),
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
