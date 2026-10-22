import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import styles from "./Splitter.module.css";

const KEY_STEP = 16;

/**
 * A vertical handle for resizing the panel to its left. Dragging updates
 * the layout live through `onPreview` (no re-render); the final width goes
 * to `onCommit`. Arrow keys step, double-click resets.
 */
export function Splitter({
  value,
  min,
  max,
  defaultValue,
  clamp,
  onPreview,
  onCommit,
  label,
}: {
  value: number;
  min: number;
  max: () => number;
  defaultValue: number;
  clamp: (width: number) => number;
  onPreview: (width: number) => void;
  onCommit: (width: number) => void;
  label: string;
}) {
  const drag = useRef<{ startX: number; startWidth: number; width: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    // Start from what's on screen, which may be narrower than saved.
    const panel = e.currentTarget.parentElement;
    const startWidth = panel?.getBoundingClientRect().width ?? value;
    drag.current = { startX: e.clientX, startWidth, width: startWidth };
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current.width = clamp(drag.current.startWidth + e.clientX - drag.current.startX);
    onPreview(drag.current.width);
  };
  const onPointerUp = () => {
    if (!drag.current) return;
    onCommit(drag.current.width);
    drag.current = null;
    setDragging(false);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowLeft: -KEY_STEP, ArrowRight: KEY_STEP }[e.key];
    if (step === undefined) return;
    e.preventDefault();
    const next = clamp(value + step);
    onPreview(next);
    onCommit(next);
  };
  const reset = () => {
    onPreview(clamp(defaultValue));
    onCommit(defaultValue);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max()}
      tabIndex={0}
      className={styles.splitter}
      data-dragging={dragging || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      onDoubleClick={reset}
    />
  );
}
