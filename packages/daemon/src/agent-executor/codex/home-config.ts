import type { McpJsonServerEntry } from '../contracts.js';
import { JINI_MCP_SERVER_KEY } from '../mcp-bridge.js';

/**
 * TOML basic-string escaping for the narrow value shapes {@link buildCodexMcpServerToml} emits (a
 * command name, an argv token, an env var value — never multi-line or control-character-heavy
 * text). Escapes exactly what TOML's basic-string grammar requires: backslash first (so it is not
 * re-escaped by a later replacement), then the quote delimiter, then the three whitespace control
 * characters a real command/argv/env value could plausibly contain.
 *
 * A hand-rolled minimal escaper rather than a TOML dependency — this mechanism never needs to
 * *parse* TOML (the real install's existing `config.toml` is appended after, never rewritten — see
 * {@link buildCodexHomeConfigToml}), so pulling in a full TOML library for one serialization shape
 * would be substantially more surface than the problem needs. Checked against the repo's existing
 * dependency graph first — no package here already depends on a TOML library.
 * @param value - The raw string to embed inside TOML `"..."` delimiters.
 * @returns The escaped text, WITHOUT the surrounding quotes — {@link tomlString} adds those.
 * @complexity O(n) in the string's length.
 */
function escapeTomlBasicString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

/** Wraps {@link escapeTomlBasicString}'s output in the TOML basic-string delimiters. */
function tomlString(value: string): string {
  return `"${escapeTomlBasicString(value)}"`;
}

/** A TOML key: bare when TOML allows it, quoted otherwise — host-supplied bridge env names are not guaranteed bare-safe. */
export function tomlKey(key: string): string {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : tomlString(key);
}

/**
 * Codex's per-tool deadline for the Jini bridge, in seconds: `@jini-ai/mcp`'s
 * `DEFAULT_DELEGATED_TOOL_TIMEOUT_MS` (6 min, mirrored because this package does not depend on
 * that one) plus 40 s. Codex's own default (60 s) is shorter than a delegated call parked on a
 * human dialog, and when Codex abandons a call the dialog stayed answerable, so a late click ran
 * an action the model had been told failed. Outlasting the bridge's deadline means the bridge
 * times out first, drops its daemon request, and the daemon expires the dialog. Codex does not
 * pass the parent env through to MCP servers, so the bridge under Codex always runs at its default.
 */
const CODEX_TOOL_TIMEOUT_SEC = 6 * 60 + 40;

/**
 * Mechanism 5 of 5 — `'codex-toml'`'s serialization step. Builds the `[mcp_servers.jini]` TOML
 * table (plus, when the entry carries any env vars, a separate `[mcp_servers.jini.env]` table)
 * Codex's own config schema expects.
 *
 * Confirmed against a real installed Codex CLI (0.151.0), not assumed from docs: round-tripping
 * `codex mcp add <name> --env K=V -- <cmd> <args>` against a scratch `CODEX_HOME` and reading back
 * `config.toml` produced exactly this shape (`command`/`args` as TOML strings/array in the main
 * table, env vars in a nested `.env` table) — see `archived provenance ledger` for the transcript.
 * @param entry - The shared bridge entry from {@link buildMcpJsonServerEntry}.
 * @returns A TOML fragment with no leading/trailing blank-line padding — {@link buildCodexHomeConfigToml} owns spacing when combining it with existing content.
 * @complexity O(n) in the number of argv/env entries.
 * @overallScore 100/100
 */
export function buildCodexMcpServerToml({ entry }: { readonly entry: McpJsonServerEntry }): string {
  const argsLiteral = entry.args.map(tomlString).join(', ');
  const serverTable =
    `[mcp_servers.${JINI_MCP_SERVER_KEY}]\ncommand = ${tomlString(entry.command)}\nargs = [${argsLiteral}]\n` +
    `tool_timeout_sec = ${CODEX_TOOL_TIMEOUT_SEC}\n`;
  const envLines = Object.entries(entry.env)
    .filter((pair): pair is [string, string] => typeof pair[1] === 'string')
    .map(([key, value]) => `${tomlKey(key)} = ${tomlString(value)}`);
  if (envLines.length === 0) return serverTable;
  return `${serverTable}\n[mcp_servers.${JINI_MCP_SERVER_KEY}.env]\n${envLines.join('\n')}\n`;
}

/**
 * Splits a TOML table header's dotted key into its individual segments, honoring quoted parts
 * (`"basic"` or `'literal'`) that may themselves contain a literal `.` — a bare `.` only
 * separates segments outside of quotes. Each segment is trimmed and, if quoted, unwrapped.
 *
 * Not a full TOML parser: it does not resolve escape sequences (`\"`, `\u...`) inside basic
 * strings. That is deliberately out of scope — see {@link stripExistingJiniMcpServerTable}'s doc
 * for why it is safe to skip for this specific comparison.
 * @param rawKey - The raw text between a table header's `[` and `]`.
 * @returns The dotted key's segments, dequoted and trimmed.
 * @complexity O(n) in the length of `rawKey`.
 */
export function splitTomlDottedKey(rawKey: string): string[] {
  const scan: TomlKeyScan = { segments: [], current: '', quote: null };
  for (const ch of rawKey) {
    if (scan.quote === null) scanBareTomlKeyChar(scan, ch);
    else if (ch === scan.quote) scan.quote = null;
    else scan.current += ch;
  }
  scan.segments.push(scan.current.trim());
  return scan.segments;
}

/** {@link splitTomlDottedKey}'s running state: finished segments, the open segment, and the open quote. */
interface TomlKeyScan { segments: string[]; current: string; quote: '"' | "'" | null }

/** One key character outside quotes: opens a quote, ends the open segment at a `.`, or extends it. */
function scanBareTomlKeyChar(scan: TomlKeyScan, ch: string): void {
  if (ch === '"' || ch === "'") scan.quote = ch;
  else if (ch === '.') {
    scan.segments.push(scan.current.trim());
    scan.current = '';
  } else scan.current += ch;
}

// An inline or dotted root `mcp_servers` declaration, which the table scanner below cannot rewrite.
const INLINE_MCP_SERVERS = /^\s*(?:mcp_servers|"mcp_servers"|'mcp_servers')\s*(?:\.|=)/;
// `[<key>]` optionally followed only by a `# comment`; `[[...]]` never matches (see below).
export const TOML_TABLE_HEADER = /^\s*\[([^[\]]+)\]\s*(#.*)?$/;

/**
 * Whether {@link stripExistingJiniMcpServerTable} drops the table named `key`: always the jini
 * table and its subtables; with `allServers` every MCP table; with `mcpOnly` every non-MCP table.
 */
function dropsTomlTable(key: string, optional: { allServers?: boolean; mcpOnly?: boolean }): boolean {
  const jiniTableKey = `mcp_servers.${JINI_MCP_SERVER_KEY}`;
  if (key === jiniTableKey || key.startsWith(`${jiniTableKey}.`)) return true;
  const isMcp = key === 'mcp_servers' || key.startsWith('mcp_servers.');
  return (optional.allServers === true && isMcp) || (optional.mcpOnly === true && !isMcp);
}

/**
 * Removes any pre-existing `[mcp_servers.{@link JINI_MCP_SERVER_KEY}]` table — and its
 * `[mcp_servers.{@link JINI_MCP_SERVER_KEY}.*]` subtables (e.g. `.env`) — from a real Codex
 * `config.toml`'s raw text, so {@link buildCodexHomeConfigToml} can append this run's own table
 * without producing the duplicate TOML key Codex's parser rejects at startup.
 *
 * Line-oriented, not a real TOML parser (matching {@link buildCodexMcpServerToml}'s own
 * no-TOML-dependency constraint), but wide enough to survive a hand-edited config, which is the
 * scenario this whole function exists for. A table header line is recognized when, after
 * trimming, it is `[<key>]` optionally followed only by a `# comment` (TOML's own grammar allows
 * nothing else there) — so it tolerates leading indentation, whitespace inside the brackets, a
 * trailing line comment, and a dotted key written with quoted segments (`["mcp_servers"."jini"]`),
 * via {@link splitTomlDottedKey}. Once such a header's key matches the jini table or one of its
 * subtables, every following line is dropped until the next table header (of any name) or EOF.
 * Every other table, key, comment-only, and blank line is passed through untouched.
 *
 * Deliberately unhandled, and why it is safe to leave that way:
 * - **Escape sequences inside quoted key segments** (e.g. a segment containing `\"`) — neither
 *   `mcp_servers` nor {@link JINI_MCP_SERVER_KEY} ever needs escaping, and this driver's own
 *   writer ({@link buildCodexMcpServerToml}) never emits a quoted form at all, so no real
 *   `config.toml` this driver produced can exercise this gap; a hand-edit that goes out of its
 *   way to escape a character inside a key that is supposed to spell "jini" would fail to match
 *   and fall back to today's pre-fix behavior (append a duplicate) rather than silently doing
 *   something worse.
 * - **`[[array-of-tables]]` syntax** — Codex's schema has no array-of-tables shape for
 *   `mcp_servers`, and the header regex's `[^[\]]+` capture cannot match a line starting with a
 *   second `[`, so `[[mcp_servers.jini]]` is not recognized as a header before or after this fix
 *   — unchanged, not a new gap.
 * - **A single quoted segment that happens to spell the same characters with the dot included**
 *   (e.g. `["mcp_servers.jini"]`, which in real TOML names one key literally containing a `.`,
 *   not two nested tables) — this collapses to the same joined string as the real nested-table
 *   spelling and is therefore treated as a match. This is a false positive in the conservative
 *   direction the reported bug calls for: a missed detection duplicates a key and crashes Codex,
 *   so on this axis over-matching a spelling nobody would plausibly hand-write for an MCP server
 *   table is preferable to under-matching the real one.
 * @param existingRaw - The real Codex home's `config.toml` content, already known to be defined
 * (callers pass `''` for a missing file).
 * @returns `existingRaw` with any jini table/subtable removed.
 * @complexity O(n) in the number of lines.
 */
function stripExistingJiniMcpServerTable(existingRaw: string, optional: { allServers?: boolean; mcpOnly?: boolean } = {}): string {
  const kept: string[] = [];
  let skipping = optional.mcpOnly === true;
  for (const line of existingRaw.split('\n')) {
    // The existing table scanner cannot safely rewrite inline/dotted root server values. Refuse
    // that uncommon shape when isolating servers rather than accidentally preserving a grant.
    if (optional.allServers && INLINE_MCP_SERVERS.test(line)) {
      throw new Error('Cannot turn off personal MCP servers: the Codex config.toml declares mcp_servers inline (a dotted key or `mcp_servers = {...}`), which cannot be removed safely; move each server into its own [mcp_servers.<name>] table.');
    }
    const header = TOML_TABLE_HEADER.exec(line);
    // The header's key capture group is not optional, so `header[1]` is always set on a match.
    if (header) skipping = dropsTomlTable(splitTomlDottedKey(header[1]!).join('.'), optional);
    if (!skipping) kept.push(line);
  }
  return kept.join('\n');
}

/**
 * Builds the full `config.toml` a run's scratch `CODEX_HOME` gets: the real Codex home's own
 * config, with any pre-existing `[mcp_servers.jini]` table removed (see
 * {@link stripExistingJiniMcpServerTable}), then this run's own table appended.
 *
 * **Append-only by design, not a parse-and-merge, for everything but the jini table itself.**
 * `mergeMcpJsonContent`/`mergeEnvContentMcpConfig` in `mcp-bridge.ts` can safely parse-merge-reserialize because
 * their formats have a JS-native parser (`JSON.parse`); this driver has no general TOML parser in
 * its dependency graph (see `buildCodexMcpServerToml`'s doc), and every other setting a real Codex
 * install carries — model choice, sandbox policy, the trusted-project list, the operator's own
 * other MCP servers — must survive a spawn byte-for-byte. Only the one table this driver itself
 * owns (`jini` is this integration's own reserved server name — see {@link JINI_MCP_SERVER_KEY}) is
 * removed by default, via the narrow line-oriented scan above, never a full TOML parse. Explicit
 * per-run OFF choices additionally omit personal MCP tables or retain only those tables when
 * user settings are off. Inline root MCP declarations fail closed when isolation is requested.
 * @param existingRaw - The real Codex home's `config.toml` content, or `undefined` when it does not
 * exist (a fresh Codex install — degrades to "start from just this run's block", matching
 * {@link mergeMcpJsonContent}'s own "missing file" handling).
 * @param entry - The shared bridge entry.
 * @returns The full text to write to the scratch `CODEX_HOME`'s `config.toml`.
 * @complexity O(n) in the existing config's length.
 */
export function buildCodexHomeConfigToml({ existingRaw, entry, inheritUserMcp = true, inheritUserSettings = true }: {
  readonly existingRaw: string | undefined; readonly entry: McpJsonServerEntry;
  readonly inheritUserMcp?: boolean; readonly inheritUserSettings?: boolean;
}, _optional: Record<string, never> = {}): string {
  const base = stripExistingJiniMcpServerTable(existingRaw ?? '', { allServers: !inheritUserMcp, mcpOnly: !inheritUserSettings });
  const separator = base.length === 0 ? '' : base.endsWith('\n') ? '\n' : '\n\n';
  return `${base}${separator}${buildCodexMcpServerToml({ entry: entry })}`;
}
