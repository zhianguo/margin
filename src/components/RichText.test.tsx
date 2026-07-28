import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InlineRichText, RichText } from "./RichText";

describe("RichText math rendering", () => {
  it.each([
    String.raw`$\omega + \pi$`,
    String.raw`\(\omega + \pi\)`,
    String.raw`\[\omega + \pi\]`
  ])("renders supported math delimiters with KaTeX", (value) => {
    const { container } = render(<RichText>{value}</RichText>);

    expect(container.querySelector(".katex")).not.toBeNull();
    expect(container.querySelector(".katex-error")).toBeNull();
  });

  it("renders alternate display delimiters in display mode", () => {
    const { container } = render(
      <RichText>{String.raw`\[\frac{\omega_n}{2\zeta}\]`}</RichText>
    );

    expect(container.querySelector(".katex-display")).not.toBeNull();
  });

  it("renders inline math without introducing a paragraph", () => {
    const { container } = render(
      <h3>
        <InlineRichText>{String.raw`$H_\infty$ robustness`}</InlineRichText>
      </h3>
    );

    expect(container.querySelector("h3 > span > p")).toBeNull();
    expect(container.querySelector("h3 .katex")).not.toBeNull();
  });

  it("shows malformed notation as neutral readable text", () => {
    const { container } = render(
      <RichText>{String.raw`$\notARealCommand{$`}</RichText>
    );

    expect(container.querySelector(".katex-error")).toBeNull();
    expect(container.querySelector(".math-fallback")).toHaveTextContent(
      String.raw`\notARealCommand{`
    );
  });
});
