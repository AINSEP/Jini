export interface StaticExportInput { jobId?: string; themeIds?: readonly string[]; publicUrl?: string }
export interface StaticExportTheme { themeId: string; name: string }
export interface StaticExportOptions { activeThemeId: string; themes: readonly StaticExportTheme[] }

/** The host's portable-path policy and refusal for malformed selection input. */
export interface StaticExportSelectionPolicy {
  /** Throws when `path` may not be published in the archive. */
  validateSharePath(required: { path: string }): void;
  /** Always throws the host's refusal for malformed input; this module never builds the message. */
  invalidInput(): never;
}

/** The host's portable-path policy for allocating theme folder names. */
export interface StaticExportAllocationPolicy {
  validateSharePath(required: { path: string }): void;
  /** Folds a name to its case/Unicode collision alias. */
  sharePathAlias(required: { path: string }): string;
}

/** One HTTP/tool start-or-resume contract. Never changes submitted selection order.
 * @throws whatever `policy.invalidInput` throws, for malformed input, repeated IDs or selection on a resume.
 * @complexity O(input bytes + IDs), no effects.
 */
export function parseStaticExportInput({ input, policy }: { input: unknown; policy: StaticExportSelectionPolicy }, _options = {}): StaticExportInput {
  if (typeof input !== "object" || input === null || Array.isArray(input)) policy.invalidInput();
  const raw = input as Record<string, unknown>;
  if (Object.keys(raw).some(key => !["jobId", "themeIds", "publicUrl"].includes(key))) policy.invalidInput();
  if (raw.jobId !== undefined) {
    return { jobId: readStaticJobId({ input: raw, policy }) };
  }
  const publicUrl = readPublicUrl({ value: raw.publicUrl, policy });
  const themeIds = raw.themeIds === undefined ? undefined : readThemeIds({ value: raw.themeIds, policy });
  return { ...(themeIds === undefined ? {} : { themeIds }), ...(publicUrl === undefined ? {} : { publicUrl }) };
}

/** Only parse the input shape here; the existing export-origin owner validates the destination. */
function readPublicUrl({ value, policy }: { value: unknown; policy: StaticExportSelectionPolicy }, _options = {}): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) policy.invalidInput();
  return value as string;
}

/** A resume cannot change the selection that the job already captured. */
function readStaticJobId({ input, policy }: { input: Record<string, unknown>; policy: StaticExportSelectionPolicy }, _options = {}): string {
  if (typeof input.jobId !== "string" || !/^[0-9a-f-]{36}$/.test(input.jobId) || input.themeIds !== undefined || input.publicUrl !== undefined) policy.invalidInput();
  return input.jobId as string;
}

/** Theme IDs are canonical single path segments; installed membership is checked by the backend. */
function readThemeIds({ value, policy }: { value: unknown; policy: StaticExportSelectionPolicy }, _options = {}): string[] {
  if (!Array.isArray(value) || !value.length) policy.invalidInput();
  const seen = new Set<string>();
  for (const id of value as unknown[]) {
    if (typeof id !== "string" || !id || /[/\\%?#]/.test(id) || seen.has(id)) policy.invalidInput();
    try { policy.validateSharePath({ path: `sites/${id}/index.html` }); } catch { policy.invalidInput(); }
    seen.add(id as string);
  }
  return [...seen];
}

/** Allocate portable names from the entire roster so options and selected subsets agree.
 * Sorting makes case/Unicode collision suffixes independent of discovery and selection order.
 * @complexity O(T log T + collision retries), O(T) memory; no I/O.
 */
export function allocateStaticExportThemes({ themeIds, siteSlug, policy }: { themeIds: readonly string[]; siteSlug: string; policy: StaticExportAllocationPolicy }, _options = {}): StaticExportTheme[] {
  // The site-slug prefix is branding, not part of the portable theme folder name.
  const prefix = siteSlug.split("-")[0] + "-";
  const names = new Map<string, string>(), claimed = new Set<string>();
  for (const themeId of [...themeIds].sort()) {
    const short = (themeId.startsWith(prefix) && themeId.length > prefix.length ? themeId.slice(prefix.length) : themeId).normalize("NFC");
    let name = short, suffix = 1;
    while (claimed.has(policy.sharePathAlias({ path: name }))) {
      suffix += 1;
      name = `${short}-${suffix}`;
    }
    policy.validateSharePath({ path: `sites/${name}/index.html` });
    names.set(themeId, name);
    claimed.add(policy.sharePathAlias({ path: name }));
  }
  return themeIds.map(themeId => {
    const name = names.get(themeId);
    if (name === undefined) throw new Error(`Static export has no allocated folder for theme ${themeId}`);
    return { themeId, name };
  });
}
