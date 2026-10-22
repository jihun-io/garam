import type { GraphLine, GraphRow } from "./graph";
import styles from "./History.module.css";

/** Horizontal space per lane. */
const LANE = 12;
/** Lanes past this many are cut off rather than widening the list. */
export const MAX_LANES = 10;

export type NodeShape = "commit" | "head" | "wip" | "stash";

export function graphWidth(lanes: number): number {
  return Math.min(lanes, MAX_LANES) * LANE + LANE / 2;
}

const x = (lane: number) => LANE / 2 + 2 + lane * LANE;

/** One row's slice of the commit graph: lines through it and its node. */
export function GraphCell({
  row,
  lanes,
  height,
  shape,
}: {
  row: GraphRow;
  lanes: number;
  height: number;
  shape: NodeShape;
}) {
  const mid = height / 2;
  const path = (line: GraphLine, top: number, bottom: number) => {
    const [x1, x2] = [x(line.from), x(line.to)];
    if (x1 === x2) return `M${x1} ${top}V${bottom}`;
    const bend = (bottom - top) * 0.6;
    return `M${x1} ${top}C${x1} ${top + bend} ${x2} ${bottom - bend} ${x2} ${bottom}`;
  };
  const cx = x(row.column);
  return (
    <svg
      className={styles.graph}
      width={graphWidth(lanes)}
      height={height}
      aria-hidden
      focusable="false"
    >
      {row.upper.map((line, i) => (
        <path
          key={`u${i}`}
          d={path(line, 0, mid)}
          strokeDasharray={line.dashed ? "3 3" : undefined}
        />
      ))}
      {row.lower.map((line, i) => (
        <path
          key={`l${i}`}
          d={path(line, mid, height)}
          strokeDasharray={line.dashed ? "3 3" : undefined}
        />
      ))}
      {shape === "commit" && <circle className={styles.node} cx={cx} cy={mid} r={3.5} />}
      {shape === "head" && <circle className={styles.headNode} cx={cx} cy={mid} r={4.5} />}
      {shape === "wip" && (
        <circle className={styles.hollowNode} cx={cx} cy={mid} r={4} strokeDasharray="2 2" />
      )}
      {shape === "stash" && (
        <rect className={styles.hollowNode} x={cx - 3.5} y={mid - 3.5} width={7} height={7} />
      )}
    </svg>
  );
}
