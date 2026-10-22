import axe from "axe-core";

/**
 * Accessibility violations axe finds in `node` (docs/UI.md 6단계). Rules
 * that need real layout (contrast) or a whole page (landmarks, headings)
 * are checked in the running app instead.
 */
export async function axeViolations(node: Element): Promise<string[]> {
  const result = await axe.run(node, {
    resultTypes: ["violations"],
    rules: {
      "color-contrast": { enabled: false },
      region: { enabled: false },
      "landmark-one-main": { enabled: false },
      "page-has-heading-one": { enabled: false },
    },
  });
  return result.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
  );
}
