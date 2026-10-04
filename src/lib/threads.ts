import type { Highlight, HighlightThread, ConversationTurn } from "../types";

const keyFor = (highlight: Highlight) =>
  `margin:thread:${highlight.documentId}:${highlight.id}`;

function sourceKey(highlight: Highlight): string {
  return JSON.stringify([highlight.text, highlight.pages, highlight.content.kind,
    highlight.content.kind === "formula" ? highlight.content.notation :
    highlight.content.kind === "diagram" ? highlight.content.layoutText : null]);
}

export function loadThread(highlight: Highlight): HighlightThread {
  const empty: HighlightThread = { version: 1, seed: "", turns: [] };
  try {
    const value = JSON.parse(localStorage.getItem(keyFor(highlight)) ?? "null");
    if (value?.sourceKey !== sourceKey(highlight) || value?.version !== 1 || typeof value.seed !== "string" ||
        !Array.isArray(value.turns) || value.turns.length > 100 ||
        !value.turns.every((turn: ConversationTurn, index: number) =>
          turn && turn.role === (index % 2 ? "assistant" : "user") &&
          typeof turn.content === "string" && turn.content.length <= 4_000) ||
        value.turns.length % 2) return empty;
    return { version: 1, seed: value.seed.slice(0, 4_000), turns: value.turns };
  } catch { return empty; }
}

export function saveThread(highlight: Highlight, thread: HighlightThread): boolean {
  try {
    localStorage.setItem(keyFor(highlight), JSON.stringify({ ...thread, sourceKey: sourceKey(highlight) }));
    return true;
  } catch { return false; }
}

export function deleteThread(highlight: Highlight): void {
  try { localStorage.removeItem(keyFor(highlight)); } catch { /* unavailable storage */ }
}

export function priorTurns(thread: HighlightThread): ConversationTurn[] {
  // Preserve the original explanation and the latest three complete exchanges.
  return [
    ...(thread.seed ? [{ role: "assistant" as const, content: thread.seed }] : []),
    ...thread.turns.slice(-6)
  ];
}
