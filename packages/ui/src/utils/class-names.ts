/** `base` plus a caller-supplied extra class, space-separated; an absent or empty extra adds nothing. */
export function withClassName({ base, extra }: { base: string; extra: string | null | undefined }, _optional: Record<string, never> = {}): string {
  return extra ? `${base} ${extra}` : base;
}
