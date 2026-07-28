import { describe, expect, it } from "vitest";
import { formatDisplayMath, normalizeRichTextMath } from "./math";

describe("normalizeRichTextMath", () => {
  it("normalizes alternate inline and display delimiters", () => {
    expect(
      normalizeRichTextMath(
        String.raw`The ratio is \(\text{zeta}\). \[\frac{\omega_n}{2}\]`
      )
    ).toBe(
      "The ratio is $\\zeta$." +
        "\n\n$$\n\\frac{\\omega_n}{2}\n$$\n\n"
    );
  });

  it("canonicalizes Greek names only inside recognized math", () => {
    expect(
      normalizeRichTextMath(
        String.raw`Use $\text{omega}$, but keep \text{omega} in prose.`
      )
    ).toBe(String.raw`Use $\omega$, but keep \text{omega} in prose.`);
  });

  it("turns compact double-dollar notation into a display block", () => {
    expect(normalizeRichTextMath(String.raw`Before $$x^2$$ after`)).toBe(
      "Before\n\n$$\nx^2\n$$\n\nafter"
    );
  });
});

describe("formatDisplayMath", () => {
  const body = String.raw`\frac{\omega_n^2}{2\zeta}`;

  it.each([
    body,
    `$${body}$`,
    `$$${body}$$`,
    String.raw`\(\frac{\omega_n^2}{2\zeta}\)`,
    String.raw`\[\frac{\omega_n^2}{2\zeta}\]`,
    `\`\`\`latex\n${body}\n\`\`\``
  ])("formats a supported equation wrapper as display math", (value) => {
    expect(formatDisplayMath(value)).toBe(`$$\n${body}\n$$`);
  });

  it("canonicalizes known Greek text commands", () => {
    expect(formatDisplayMath(String.raw`\text{omega}_n + \text{Sigma}`)).toBe(
      "$$\n\\omega_n + \\Sigma\n$$"
    );
  });

  it("does not remove internal dollar signs", () => {
    expect(formatDisplayMath(String.raw`\text{cost} = \$5`)).toBe(
      "$$\n\\text{cost} = \\$5\n$$"
    );
  });

  it("returns no math block for an empty expression", () => {
    expect(formatDisplayMath("  ")).toBe("");
  });
});
