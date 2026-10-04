import { useEffect, useRef, useState } from "react";
import type { ExplanationRecord, Highlight } from "../types";
import { requestExplanation, type ExplainPayload } from "../lib/explain";
import { loadThread, priorTurns, saveThread } from "../lib/threads";
import { RichText } from "./RichText";

interface Props {
  highlight: Highlight;
  record?: ExplanationRecord;
  getContext: () => Promise<Omit<ExplainPayload, "followUp">>;
}

export function FollowUpThread({ highlight, record, getContext }: Props) {
  const [thread, setThread] = useState(() => loadThread(highlight));
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const controllerRef = useRef<AbortController | null>(null);
  const regenerating = record?.status === "loading";

  useEffect(() => () => controllerRef.current?.abort(), []);
  useEffect(() => {
    if (regenerating) {
      controllerRef.current?.abort();
      controllerRef.current = null;
      setBusy(false);
    }
  }, [regenerating]);

  async function ask() {
    const text = question.trim();
    if (!text || busy || regenerating || thread.turns.length >= 100) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy(true);
    setError("");
    const seed = thread.seed || JSON.stringify(record?.data ?? {}).slice(0, 4_000);
    try {
      const context = await getContext();
      if (controller.signal.aborted) return;
      const result = await requestExplanation({
        ...context,
        followUp: { question: text, turns: priorTurns({ ...thread, seed }) }
      }, controller.signal);
      if (controller.signal.aborted || controllerRef.current !== controller) return;
      const answer = [result.explanation.summary, result.explanation.intuition,
        ...result.explanation.details,
        ...result.explanation.terms.map((term) => `${term.term}: ${term.meaning}`),
        ...result.explanation.equations.map((equation) => `${equation.expression}: ${equation.interpretation}`),
        ...result.explanation.connections, result.explanation.uncertainty]
        .filter(Boolean).join("\n\n").slice(0, 4_000);
      if (!answer.trim()) throw new Error("The model returned an empty answer. Please retry.");
      const next = { ...thread, seed, turns: [...thread.turns,
        { role: "user" as const, content: text },
        { role: "assistant" as const, content: answer }] };
      setThread(next);
      setQuestion("");
      if (!saveThread(highlight, next)) setError("Browser storage is unavailable. This conversation will not survive a reload.");
    } catch (error) {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Could not answer. Please retry.");
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        setBusy(false);
      }
    }
  }

  return <section className="follow-up-thread" aria-label="Follow-up conversation">
    <h3>Ask about this highlight</h3>
    <p>Saved in this browser. Regenerating an explanation keeps this conversation.</p>
    <div aria-live="polite">
      {thread.turns.map((turn, index) => <div className={`thread-turn ${turn.role}`} key={index}>
        <strong>{turn.role === "user" ? "You" : "Margin"}</strong>
        <RichText>{turn.content}</RichText>
      </div>)}
    </div>
    {error ? <p role="alert">{error}</p> : null}
    <form onSubmit={(event) => { event.preventDefault(); void ask(); }}>
      <label htmlFor="follow-up-question">Follow-up question</label>
      <textarea id="follow-up-question" maxLength={2_000} value={question}
        onChange={(event) => setQuestion(event.target.value)} disabled={busy || regenerating} />
      <button type="submit" disabled={busy || regenerating || !question.trim() || thread.turns.length >= 100 || (!record?.data && !thread.seed)}>
        {busy ? "Answering…" : "Ask follow-up"}
      </button>
    </form>
    <small>Only this passage, bounded page context, the original explanation and recent turns are sent to your configured model.</small>
  </section>;
}
