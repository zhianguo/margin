import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocumentSource } from "../types";
import { EmptyState } from "./EmptyState";

const currentSource: DocumentSource = {
  id: "paper-1",
  name: "Robust Control Notes",
  url: "blob:paper-1"
};

afterEach(cleanup);

describe("EmptyState resumable document", () => {
  it("offers explicit Resume and Close actions for the current PDF", () => {
    const onResume = vi.fn();
    const onCloseCurrent = vi.fn();

    render(
      <EmptyState
        currentSource={currentSource}
        onChooseFile={vi.fn()}
        onFileDrop={vi.fn()}
        onOpenDemo={vi.fn()}
        onResume={onResume}
        onCloseCurrent={onCloseCurrent}
      />
    );

    expect(screen.getByText("Robust Control Notes")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /resume/i }));
    fireEvent.click(screen.getByRole("button", { name: /close/i }));

    expect(onResume).toHaveBeenCalledOnce();
    expect(onCloseCurrent).toHaveBeenCalledOnce();
  });

  it("does not show session actions without a current PDF", () => {
    render(
      <EmptyState
        currentSource={null}
        onChooseFile={vi.fn()}
        onFileDrop={vi.fn()}
        onOpenDemo={vi.fn()}
        onResume={vi.fn()}
        onCloseCurrent={vi.fn()}
      />
    );

    expect(screen.queryByRole("button", { name: /resume/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /close/i })).toBeNull();
  });
});
