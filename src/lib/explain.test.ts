import { afterEach, describe, expect, it, vi } from "vitest";
import { requestExplanation } from "./explain";

const payload = {
  selectedText: "The closed-loop poles determine stability.",
  pageContext: "A paragraph about the characteristic equation.",
  pageNumber: 1,
  documentTitle: "Control Systems",
  mode: "plain" as const
};

describe("requestExplanation", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns a structured explanation from the server", async () => {
    const responseBody = {
      explanation: {
        title: "Poles and stability",
        summary: "Poles describe whether modes decay.",
        intuition: "They act like the natural tendencies of the system.",
        details: [],
        terms: [],
        equations: [],
        connections: [],
        checkQuestion: "What happens when a pole moves right?",
        uncertainty: ""
      },
      model: "test-model",
      provider: "llamacpp"
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(responseBody), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      )
    );

    await expect(requestExplanation(payload)).resolves.toEqual(responseBody);
  });

  it("sends corrected formula notation separately from PDF OCR text", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          explanation: {
            title: "An Euler product",
            summary: "A product over primes.",
            intuition: "",
            details: [],
            terms: [],
            equations: [],
            connections: [],
            checkQuestion: "",
            uncertainty: ""
          },
          model: "test-model",
          provider: "llamacpp"
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await requestExplanation({
      ...payload,
      selectedText: "L(s,o)=R(det[l",
      selectedFormulaLatex:
        "L(s,\\sigma)=\\prod_p\\det(I_n-\\sigma(\\mathrm{Fr}_p)p^{-s})^{-1}"
    });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body));
    expect(body).toMatchObject({
      selectedText: "L(s,o)=R(det[l",
      selectedFormulaLatex:
        "L(s,\\sigma)=\\prod_p\\det(I_n-\\sigma(\\mathrm{Fr}_p)p^{-s})^{-1}"
    });
    expect(body).not.toHaveProperty("visualContext");
  });

  it("sends approximate diagram layout as separate visual context", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          explanation: {
            title: "A commutative square",
            summary: "The two paths agree.",
            intuition: "",
            details: [],
            terms: [],
            equations: [],
            connections: [],
            checkQuestion: "",
            uncertainty: ""
          },
          model: "test-model",
          provider: "llamacpp"
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await requestExplanation({
      ...payload,
      selectedText: "A B C D",
      visualContext: {
        kind: "diagram",
        layoutText: "A  →  B\n↓     ↓\nC  →  D"
      }
    });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({
      selectedText: "A B C D",
      visualContext: {
        kind: "diagram",
        layoutText: "A  →  B\n↓     ↓\nC  →  D"
      }
    });
  });

  it("surfaces the server's configuration error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: "The selected LLM provider is not configured.",
            code: "MISSING_PROVIDER_CONFIG"
          }),
          {
            status: 503,
            headers: { "Content-Type": "application/json" }
          }
        )
      )
    );

    await expect(requestExplanation(payload)).rejects.toMatchObject({
      message: "The selected LLM provider is not configured.",
      code: "MISSING_PROVIDER_CONFIG"
    });
  });
});
