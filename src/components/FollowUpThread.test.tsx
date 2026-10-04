import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FollowUpThread } from "./FollowUpThread";
import { requestExplanation } from "../lib/explain";
import { deleteThread, loadThread, priorTurns, saveThread } from "../lib/threads";
import type { ExplanationRecord, Highlight } from "../types";

vi.mock("../lib/explain", () => ({ requestExplanation: vi.fn() }));
const highlight: Highlight = { id: "a", documentId: "doc", text: "A passage", content: { kind: "text" }, pages: [{ pageNumber: 2, rects: [] }], color: "amber", createdAt: "today" };
const data = { title: "Initial", summary: "Original context", intuition: "", details: [], terms: [], equations: [], connections: [], checkQuestion: "", uncertainty: "" };
const record: ExplanationRecord = { highlightId: "a", mode: "plain", status: "success", data };
const getContext = vi.fn(async () => ({ selectedText: highlight.text, pageContext: "Only page two", pageNumber: 2, documentTitle: "Paper", mode: "plain" as const }));
const props = { highlight, record, getContext };
beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); vi.mocked(requestExplanation).mockResolvedValue({ explanation: { ...data, summary: "Follow-up answer" }, model: "local", provider: "llamacpp" }); });
afterEach(cleanup);
async function ask() {
  fireEvent.change(screen.getByLabelText("Follow-up question"), { target: { value: "Why?" } });
  fireEvent.click(screen.getByText("Ask follow-up"));
  await screen.findByText("Follow-up answer");
}

it("persists complete exchanges across remounts and bounds model context", async () => {
  const view = render(<FollowUpThread {...props} />);
  await ask();
  expect(loadThread(highlight).turns).toHaveLength(2);
  const sent = vi.mocked(requestExplanation).mock.calls[0][0];
  expect(sent).toMatchObject({ selectedText: "A passage", pageContext: "Only page two", followUp: { question: "Why?" } });
  expect(sent.webSearch).toBeUndefined();
  view.unmount();
  render(<FollowUpThread {...props} record={undefined} />);
  expect(screen.getByText("Why?")).toBeInTheDocument();
  expect(screen.getByText("Follow-up answer")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Follow-up question"), { target: { value: "More?" } });
  expect(screen.getByText("Ask follow-up")).not.toBeDisabled();
});

it("isolates highlights and documents and restores a switched thread", async () => {
  const view = render(<FollowUpThread {...props} key="a" />);
  await ask();
  view.rerender(<FollowUpThread {...props} highlight={{ ...highlight, id: "b" }} key="b" />);
  expect(screen.queryByText("Follow-up answer")).toBeNull();
  view.rerender(<FollowUpThread {...props} highlight={{ ...highlight, documentId: "other" }} key="other" />);
  expect(screen.queryByText("Why?")).toBeNull();
  view.rerender(<FollowUpThread {...props} key="a" />);
  expect(screen.getByText("Follow-up answer")).toBeInTheDocument();
});

it("preserves the original seed on regeneration and discards an in-flight answer", async () => {
  const view = render(<FollowUpThread {...props} />);
  await ask();
  let resolve!: (value: Awaited<ReturnType<typeof requestExplanation>>) => void;
  vi.mocked(requestExplanation).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  fireEvent.change(screen.getByLabelText("Follow-up question"), { target: { value: "Again?" } });
  fireEvent.click(screen.getByText("Ask follow-up"));
  await waitFor(() => expect(requestExplanation).toHaveBeenCalledTimes(2));
  view.rerender(<FollowUpThread {...props} record={{ ...record, status: "loading" }} />);
  expect(vi.mocked(requestExplanation).mock.calls[1][1]?.aborted).toBe(true);
  resolve({ explanation: { ...data, summary: "Late answer" }, model: "local", provider: "llamacpp" });
  view.rerender(<FollowUpThread {...props} record={{ ...record, data: { ...data, summary: "Regenerated" } }} />);
  await waitFor(() => expect(screen.queryByText("Late answer")).toBeNull());
  expect(loadThread(highlight).seed).toContain("Original context");
  expect(loadThread(highlight).turns).toHaveLength(2);
});

it("retains the question after errors and reports storage failure", async () => {
  vi.mocked(requestExplanation).mockRejectedValueOnce(new Error("Offline"));
  render(<FollowUpThread {...props} />);
  fireEvent.change(screen.getByLabelText("Follow-up question"), { target: { value: "Why?" } });
  fireEvent.click(screen.getByText("Ask follow-up"));
  await screen.findByText("Offline");
  expect(screen.getByLabelText("Follow-up question")).toHaveValue("Why?");
  const storage = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Full"); });
  fireEvent.click(screen.getByText("Ask follow-up"));
  await screen.findByText(/Browser storage is unavailable/);
  storage.mockRestore();
});

it("bounds prior turns, rejects corrupt storage and removes deleted threads", () => {
  const turns = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? "assistant" as const : "user" as const, content: `${i}` }));
  saveThread(highlight, { version: 1, seed: "Initial explanation", turns });
  expect(priorTurns(loadThread(highlight))).toHaveLength(7);
  expect(priorTurns(loadThread(highlight))[1].content).toBe("14");
  deleteThread(highlight);
  expect(loadThread(highlight).turns).toEqual([]);
  localStorage.setItem("margin:thread:doc:a", "{bad");
  expect(loadThread(highlight).turns).toEqual([]);
});

it("keeps the transcript across lens changes but rejects changed source content", async () => {
  const view = render(<FollowUpThread {...props} />);
  await ask();
  view.rerender(<FollowUpThread {...props} record={{ ...record, mode: "deep" }} />);
  expect(screen.getByText("Follow-up answer")).toBeInTheDocument();
  expect(loadThread({ ...highlight, text: "Changed passage" }).turns).toEqual([]);
});

it("aborts a pending request when switching away without saving partial turns", async () => {
  vi.mocked(requestExplanation).mockImplementation(() => new Promise(() => {}));
  const view = render(<FollowUpThread {...props} />);
  fireEvent.change(screen.getByLabelText("Follow-up question"), { target: { value: "Why?" } });
  fireEvent.click(screen.getByText("Ask follow-up"));
  await waitFor(() => expect(requestExplanation).toHaveBeenCalledOnce());
  const signal = vi.mocked(requestExplanation).mock.calls[0][1];
  view.unmount();
  expect(signal?.aborted).toBe(true);
  expect(loadThread(highlight).turns).toEqual([]);
});
