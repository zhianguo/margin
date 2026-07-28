import { Highlighter, Sparkles } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import type { CapturedSelection } from "../types";

interface SelectionPopoverProps {
  selection: CapturedSelection;
  onHighlight: () => void;
  onExplain: () => void;
}

export function SelectionPopover({
  selection,
  onHighlight,
  onExplain
}: SelectionPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({
    left: selection.viewportAnchor.left,
    top: selection.viewportAnchor.top - 54
  });

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const bounds = element.getBoundingClientRect();
    const gutter = 12;
    const centeredLeft = selection.viewportAnchor.left - bounds.width / 2;
    const left = Math.min(
      window.innerWidth - bounds.width - gutter,
      Math.max(gutter, centeredLeft)
    );
    const above = selection.viewportAnchor.top - bounds.height - 10;
    const top =
      above > 72
        ? above
        : Math.min(
            window.innerHeight - bounds.height - gutter,
            selection.viewportAnchor.bottom + 10
          );
    setPosition({ left, top });
  }, [selection]);

  return (
    <div
      ref={ref}
      className="selection-popover"
      role="toolbar"
      aria-label="Selection actions"
      style={position}
      onMouseDown={(event) => event.preventDefault()}
    >
      <button type="button" onClick={onExplain}>
        <Sparkles size={15} />
        Explain
      </button>
      <span />
      <button type="button" onClick={onHighlight}>
        <Highlighter size={15} />
        Keep
      </button>
    </div>
  );
}
