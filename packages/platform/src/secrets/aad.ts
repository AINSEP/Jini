/** Formats an existing colon-separated AAD lineage without escaping or changing its bytes. */
export function formatAad({ kind, version, parts }: { kind: string; version: string; parts: readonly string[] }): string {
  return [kind, version, ...parts].join(":");
}
