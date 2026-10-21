/**
 * Garam's mark: a stream that splits into two branches and merges again,
 * echoing both the name (가람, "river") and a Git branch/merge.
 */
export function RiverMark({ size = 56 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 56 56"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M28 4 C28 14 28 16 28 18 C28 24 14 24 14 30 C14 36 28 36 28 42 C28 44 28 46 28 52"
        stroke="var(--color-river)"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <path
        d="M28 18 C28 24 42 24 42 30 C42 36 28 36 28 42"
        stroke="var(--color-river-strong)"
        strokeWidth="5"
        strokeLinecap="round"
        opacity="0.55"
      />
    </svg>
  );
}
