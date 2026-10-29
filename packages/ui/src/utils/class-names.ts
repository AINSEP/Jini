/** `base` plus a caller-supplied extra class, space-separated; an absent or empty extra adds nothing. */
export function withClassName(base: string, extra: string | null | undefined): string {
  return extra ? `${base} ${extra}` : base;
}
