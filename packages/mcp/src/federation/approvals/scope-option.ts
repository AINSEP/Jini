/** The opaque host storage partition as a port's options object: `{}` when absent, so a port
 *  never receives `{ scope: undefined }`. @complexity O(1). */
export function scopeOption({ scope }: { scope: string | undefined }, _optional: Record<string, never> = {}): { scope?: string } {
  return scope === undefined ? {} : { scope };
}
