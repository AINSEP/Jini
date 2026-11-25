/** The bridge delivery for a Codex run: the shared entry, written into a staged home's `config.toml` (see `home-staging.ts`). */
export function buildCodexMcpDelivery<E>({ serverEntry }: { readonly serverEntry: E }, _optional: Record<string, never> = {}): { readonly kind: 'codex-toml'; readonly serverEntry: E } {
  return { kind: 'codex-toml', serverEntry };
}
