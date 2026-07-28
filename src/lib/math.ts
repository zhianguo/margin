const greekTextCommands: Record<string, string> = {
  alpha: "alpha",
  beta: "beta",
  gamma: "gamma",
  delta: "delta",
  epsilon: "epsilon",
  varepsilon: "varepsilon",
  zeta: "zeta",
  eta: "eta",
  theta: "theta",
  vartheta: "vartheta",
  iota: "iota",
  kappa: "kappa",
  varkappa: "varkappa",
  lambda: "lambda",
  mu: "mu",
  nu: "nu",
  xi: "xi",
  pi: "pi",
  varpi: "varpi",
  rho: "rho",
  varrho: "varrho",
  sigma: "sigma",
  varsigma: "varsigma",
  tau: "tau",
  upsilon: "upsilon",
  phi: "phi",
  varphi: "varphi",
  chi: "chi",
  psi: "psi",
  omega: "omega",
  Gamma: "Gamma",
  Delta: "Delta",
  Theta: "Theta",
  Lambda: "Lambda",
  Xi: "Xi",
  Pi: "Pi",
  Sigma: "Sigma",
  Upsilon: "Upsilon",
  Phi: "Phi",
  Psi: "Psi",
  Omega: "Omega"
};

const greekNames = Object.keys(greekTextCommands)
  .sort((left, right) => right.length - left.length)
  .join("|");
const greekTextPattern = new RegExp(
  String.raw`\\text\s*\{\s*(${greekNames})\s*\}`,
  "g"
);

function canonicalizeLatex(value: string): string {
  return value.replace(
    greekTextPattern,
    (_match, name: string) => `\\${greekTextCommands[name]}`
  );
}

function normalizeDisplayMath(value: string): string {
  return `\n\n$$\n${canonicalizeLatex(value.trim())}\n$$\n\n`;
}

export function normalizeRichTextMath(value: string): string {
  return value
    .replace(/[ \t]*\$\$([\s\S]*?)\$\$[ \t]*/g, (_match, body: string) =>
      normalizeDisplayMath(body)
    )
    .replace(
      /(?<!\\)\$(?!\$)([^\n$]*?)(?<!\\)\$(?!\$)/g,
      (_match, body: string) => `$${canonicalizeLatex(body)}$`
    )
    .replace(/[ \t]*\\\[([\s\S]*?)\\\][ \t]*/g, (_match, body: string) =>
      normalizeDisplayMath(body)
    )
    .replace(/\\\(([\s\S]*?)\\\)/g, (_match, body: string) => {
      return `$${canonicalizeLatex(body.trim())}$`;
    });
}

function stripCodeFence(value: string): string {
  const match = value.match(
    /^```(?:math|latex|tex|katex)?[ \t]*\n?([\s\S]*?)\n?```$/i
  );
  return match ? match[1].trim() : value;
}

function stripOuterMathDelimiter(value: string): string {
  const wrappers: Array<[string, string]> = [
    ["$$", "$$"],
    ["\\[", "\\]"],
    ["\\(", "\\)"],
    ["$", "$"]
  ];

  for (const [opening, closing] of wrappers) {
    if (
      value.length >= opening.length + closing.length &&
      value.startsWith(opening) &&
      value.endsWith(closing)
    ) {
      return value.slice(opening.length, -closing.length).trim();
    }
  }

  return value;
}

export function formatDisplayMath(expression: string): string {
  const withoutFence = stripCodeFence(expression.trim());
  const body = canonicalizeLatex(
    stripOuterMathDelimiter(withoutFence).trim()
  );
  return body ? `$$\n${body}\n$$` : "";
}
