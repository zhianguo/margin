import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { DocumentSource } from "./types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const documentMocks = vi.hoisted(() => ({
  sourceFromFile: vi.fn()
}));

vi.mock("./lib/documents", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/documents")>();
  return {
    ...actual,
    sourceFromFile: documentMocks.sourceFromFile
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
  LibraryRail: () => <aside data-testid="library-rail" />
}));

vi.mock("./components/ExplanationPanel", () => ({
  ExplanationPanel: () => <aside data-testid="explanation-panel" />
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

describe("home and resume navigation", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Provider is offline"))
    );
    documentMocks.sourceFromFile.mockReset();
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
