import type { TokenSignInPlugin } from './token-sign-in.js';

/**
 * @file Bounded validation of access tokens handed over while a site is being CREATED, and of the
 * token-sign-in plugin rows a host lists for that form. Both inputs come from places the engine does
 * not trust (a renderer, a child process's stdout), so every limit is supplied by the host and no
 * rejection ever echoes a value. Generic: keyed by plugin id, no site, vendor or CLI vocabulary.
 */

/** The host's limits for one token map: its plugin-id grammar and how much it will read. */
export interface TokenMapLimits {
  /** The host's own id grammar. Required: it differs between hosts (dots are legal in some), so no default. */
  readonly pluginIdPattern: RegExp;
  readonly maxTokens: number;
  readonly maxTokenLength: number;
}

export type ParsedTokenMap =
  | { readonly ok: true; readonly tokens: Readonly<Record<string, string>> }
  | { readonly ok: false };

/**
 * `{ [pluginId]: token }` from untrusted input: values trimmed, blanks dropped, `null`/`undefined`
 * meaning "none given". A refusal carries no input, so no token can leak through an error message.
 *
 * The entry limit counts BEFORE any entry is read (it bounds the work, blanks included) and the
 * length limit is measured on the UNtrimmed value. The result has no prototype, so a plugin id such
 * as `__proto__` is just a key and can never reach `Object.prototype`.
 * @complexity O(n) in the entry count (bounded by `maxTokens`).
 */
export function parsePluginTokenMap(
  required: { readonly raw: unknown; readonly limits: TokenMapLimits },
  _optional: Record<string, never> = {},
): ParsedTokenMap {
  const { raw, limits } = required;
  const tokens = Object.create(null) as Record<string, string>;
  if (raw === undefined || raw === null) return { ok: true, tokens };
  if (typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length > limits.maxTokens) return { ok: false };
  for (const [pluginId, value] of Object.entries(raw)) {
    if (!isAcceptableEntry({ pluginId, value, limits })) return { ok: false };
    const token = (value as string).trim();
    if (token !== '') tokens[pluginId] = token;
  }
  return { ok: true, tokens };
}

/** A string token within the host's length limit, under an id the host's grammar admits. */
function isAcceptableEntry(
  required: { readonly pluginId: string; readonly value: unknown; readonly limits: TokenMapLimits },
  _optional: Record<string, never> = {},
): boolean {
  const { pluginId, value, limits } = required;
  return typeof value === 'string' && limits.pluginIdPattern.test(pluginId) && value.length <= limits.maxTokenLength;
}

/**
 * The well-formed `{ pluginId, displayName, helpUrl }` entries of a host-supplied list. Rows are
 * rendered as links in a shell, so the help link must be `https:` (never `http:`/`javascript:`).
 * Anything that is not an array is no entries.
 * @complexity O(n) in the entry count.
 */
export function decodeTokenSignInEntries(
  required: { readonly entries: unknown; readonly pluginIdPattern: RegExp },
  _optional: Record<string, never> = {},
): readonly TokenSignInPlugin[] {
  if (!Array.isArray(required.entries)) return [];
  return required.entries.flatMap((entry: unknown): TokenSignInPlugin[] => {
    const { pluginId, displayName, helpUrl } = (entry ?? {}) as Record<string, unknown>;
    if (typeof pluginId !== 'string' || !required.pluginIdPattern.test(pluginId)) return [];
    if (typeof displayName !== 'string' || typeof helpUrl !== 'string' || !/^https:\/\//.test(helpUrl)) return [];
    return [{ pluginId, displayName, helpUrl }];
  });
}
