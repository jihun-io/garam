/** The abbreviated commit id shown in the UI. */
export function shortHash(oid: string): string {
  return oid.slice(0, 7);
}
