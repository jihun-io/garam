import { create } from "zustand";

export const useTooltipState = create(() => ({ suppressed: false }));

const resumeEvents = ["pointermove", "pointerdown", "keydown"] as const;

function resumeTooltips() {
  for (const event of resumeEvents) document.removeEventListener(event, resumeTooltips, true);
  useTooltipState.setState({ suppressed: false });
}

/** Native menus consume input outside the webview, so wait for fresh web input. */
export function suppressTooltips() {
  useTooltipState.setState({ suppressed: true });
  for (const event of resumeEvents) document.addEventListener(event, resumeTooltips, true);
}
