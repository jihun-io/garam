// Lanes for the commit graph. Rows come in topological order (children
// before parents); each lane waits for one commit id. A row's node takes
// the leftmost lane waiting for it, the other lanes waiting for it end
// there, and its parents continue in lanes below: the first parent in the
// node's own lane when no lane already waits for it, others in free lanes.
// Lanes never shift sideways, so a line keeps its column until it ends.

export type GraphNode = {
  id: string;
  parents: string[];
  /** Drawn with dashed lines: uncommitted changes and stashes. */
  dashed?: boolean;
};

/** A line in one half of a row, between lane columns. */
export type GraphLine = { from: number; to: number; dashed: boolean };

export type GraphRow = {
  column: number;
  /**
   * Lanes this row draws in. Each row is only as wide as itself, so rows
   * loaded later never widen rows already on screen.
   */
  width: number;
  /** From the row's top edge to its middle. */
  upper: GraphLine[];
  /** From the row's middle to its bottom edge. */
  lower: GraphLine[];
};

export type Graph = { rows: GraphRow[] };

type Lane = { waitingFor: string; dashed: boolean } | null;

export function buildGraph(nodes: GraphNode[], firstParentOnly = false): Graph {
  const lanes: Lane[] = [];
  const rows: GraphRow[] = [];

  const take = (lane: Lane): number => {
    const free = lanes.indexOf(null);
    if (free >= 0) {
      lanes[free] = lane;
      return free;
    }
    lanes.push(lane);
    return lanes.length - 1;
  };

  for (const node of nodes) {
    const dashed = node.dashed ?? false;
    const upper: GraphLine[] = [];
    const arriving: number[] = [];
    lanes.forEach((lane, i) => {
      if (lane?.waitingFor === node.id) arriving.push(i);
    });
    const column = arriving[0] ?? take(null);

    lanes.forEach((lane, i) => {
      if (!lane) return;
      upper.push({
        from: i,
        to: lane.waitingFor === node.id ? column : i,
        dashed: lane.dashed,
      });
    });
    for (const i of arriving) lanes[i] = null;

    const lower: GraphLine[] = [];
    lanes.forEach((lane, i) => {
      if (lane) lower.push({ from: i, to: i, dashed: lane.dashed });
    });
    const parents = firstParentOnly ? node.parents.slice(0, 1) : node.parents;
    parents.forEach((parent, k) => {
      let target = lanes.findIndex((lane) => lane?.waitingFor === parent);
      if (target < 0) {
        const lane = { waitingFor: parent, dashed };
        if (k === 0 && lanes[column] === null) {
          lanes[column] = lane;
          target = column;
        } else {
          target = take(lane);
        }
      }
      lower.push({ from: column, to: target, dashed });
    });

    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();
    let width = column + 1;
    for (const line of [...upper, ...lower]) width = Math.max(width, line.from + 1, line.to + 1);
    rows.push({ column, width, upper, lower });
  }
  return { rows };
}
