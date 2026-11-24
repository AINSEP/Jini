import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { isNonArrayRecord } from "@jini-ai/core";
import { orFallbackSync } from "@jini-ai/core/errors/idioms";
import { load, FAILSAFE_SCHEMA } from "js-yaml";
import type { AgentPluginDeliveryMode } from "../lifecycle/index.js";

/**
 * @file A host's overlay for portable Agent Plugins: the one formatter for
 * `<overlaysDir>/<pluginId>/` (the host's overlay directory, always passed in as `overlaysDir`).
 *
 * A plugin's own payload (a Jini `@jini-ai/agent-plugins/<id>` subpath) describes jobs, not the host's tools.
 * The host's rules for those jobs — which tool does what, which shapes to write — live in an overlay:
 * an optional `GUIDANCE.md` placed before the plugin's guidance, and optional `host/<name>.md`
 * supporting files a model reads by asking the plugin's own tool for `file: "host/<name>.md"`.
 *
 * Both delivery seams use this file and nothing else: the host's `agent_plugin_<id>` tool wrapper
 * and its run-reference resolver. Both run AFTER the
 * plugin's activation gate, so a disabled plugin never receives its overlay. This replaced reading
 * host references through `fs_read_file` root `repo`, which site agents are refused
 * and which a packaged build does not ship anyway.
 *
 * Lookup is by `pluginId` only; a caller never supplies a path. Reads are bounded at the same
 * 256 KiB the plugin's own file reader uses.
 */

/** Same per-file cap as the plugin skill-file reader, so an overlay file is never the larger read. */
export const MAX_HOST_PLUGIN_FILE_BYTES = 256 * 1024;
/** The host answers `file` values with this prefix from the overlay; the plugin never sees them. */
export const HOST_PLUGIN_FILE_PREFIX = "host/";

// One path segment each: no dot, slash or backslash can reach `path.join`, so no traversal and
// no absolute name. A host's overlay test can pin the same file rule.
const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const HOST_FILE_PATTERN = /^host\/[a-z0-9-]+\.md$/;
const GUIDANCE_FILE = "GUIDANCE.md";

/** A plugin's overlay: the guidance to put first, and its readable `host/` file names. */
export interface HostPluginGuidance {
  readonly guidance?: string;
  readonly files: string[];
}

/** True when a plugin tool `file` value names an overlay file rather than a plugin file. */
export function isHostPluginFileRequest(required: { file: unknown }, _optional: Record<string, never> = {}): required is { file: string } {
  return typeof required.file === "string" && required.file.startsWith(HOST_PLUGIN_FILE_PREFIX);
}

/** `undefined` for absent files only; a directory or other non-file is a broken overlay and throws. */
async function readBoundedFile({ filePath }: { filePath: string }, _optional: Record<string, never> = {}): Promise<{ text: string } | { tooLarge: true } | undefined> {
  let size: number;
  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error(`Agent Plugin overlay entry is not a file: ${path.basename(filePath)}`);
    size = info.size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  if (size > MAX_HOST_PLUGIN_FILE_BYTES) return { tooLarge: true };
  return { text: await readFile(filePath, "utf8") };
}

/** Sorted `host/<name>.md` names; a missing `host/` folder lists none. O(entries log entries). */
async function listHostFiles({ pluginDir }: { pluginDir: string }, _optional: Record<string, never> = {}): Promise<string[]> {
  try {
    const entries = await readdir(path.join(pluginDir, "host"), { withFileTypes: true });
    return entries.filter(entry => entry.isFile()).map(entry => `${HOST_PLUGIN_FILE_PREFIX}${entry.name}`)
      .filter(name => HOST_FILE_PATTERN.test(name)).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/**
 * Reads one plugin's overlay guidance and host-file names.
 * @returns `{ files: [] }` when the plugin has no overlay (or an id that cannot name one).
 * @throws A `GUIDANCE.md` over 256 KiB, not a file, or unreadable — host rules are never silently dropped.
 * @complexity One stat, one bounded read, one readdir.
 */
export async function readHostPluginGuidance(required: { pluginId: string; overlaysDir: string }, _optional: Record<string, never> = {}): Promise<HostPluginGuidance> {
  if (!PLUGIN_ID_PATTERN.test(required.pluginId)) return { files: [] };
  const pluginDir = path.join(required.overlaysDir, required.pluginId);
  const guidance = await readBoundedFile({ filePath: path.join(pluginDir, GUIDANCE_FILE) });
  if (guidance && "tooLarge" in guidance) throw new Error(`Agent Plugin overlay ${required.pluginId}/${GUIDANCE_FILE} is over ${MAX_HOST_PLUGIN_FILE_BYTES} bytes`);
  const files = await listHostFiles({ pluginDir });
  return guidance ? { guidance: guidance.text, files } : { files };
}

/**
 * Reads one `host/<name>.md` overlay file. Every refusal is a note naming the valid files, the same
 * recovery shape the plugin's own file reader gives; a caller's unsafe value is never echoed.
 * @complexity One stat, one bounded read, one readdir.
 */
export async function readHostPluginFile(required: { pluginId: string; file: string; overlaysDir: string }, _optional: Record<string, never> = {}): Promise<{ text: string } | { note: string }> {
  const pluginDir = path.join(required.overlaysDir, required.pluginId);
  const valid = PLUGIN_ID_PATTERN.test(required.pluginId) ? await listHostFiles({ pluginDir }) : [];
  const read = valid.includes(required.file) ? await readBoundedFile({ filePath: path.join(pluginDir, required.file) }) : undefined;
  if (read && "text" in read) return { text: read.text };
  const label = HOST_FILE_PATTERN.test(required.file) ? ` '${required.file}'` : "";
  const reason = read ? `is over ${MAX_HOST_PLUGIN_FILE_BYTES} bytes` : "is not available";
  return { note: `Host file${label} ${reason} for the '${required.pluginId}' plugin. Valid host files: ${valid.join(", ") || "(none)"}.` };
}

// A host chat has no shell. The shared shadcn skill keeps `"Bash"` in `allowed-tools` for coding hosts;
// this removes that permission from what a chat host delivers.
const REFUSED_TOOL_ITEM = /^\s+-\s*["']?Bash["']?\s*$/;
type FrontmatterState = "body" | "frontmatter" | "allowedTools";

/** A `---` opens frontmatter only around a YAML mapping, at the top of a text, after a blank
 * line, or right after a run section's `<<AGENT_PLUGIN …>>` header. Markdown rules stay body text.
 * Reuse the same failsafe YAML reader as platform/markdown/frontmatter; retain original bytes.
 * @complexity O(candidate bytes). Candidates end at the next delimiter, so scans do not overlap. */
function opensFrontmatter({ lines, index }: { lines: readonly string[]; index: number }, _options = {}): boolean {
  const previous = lines[index - 1];
  if (previous !== undefined && previous.trim() !== "" && !previous.startsWith("<<AGENT_PLUGIN")) return false;
  let end = index + 1;
  while (end < lines.length && lines[end]!.trimEnd() !== "---") end++;
  if (end === lines.length) return false;
  return orFallbackSync({
    work: () => isNonArrayRecord({ value: load(lines.slice(index + 1, end).join("\n"), { schema: FAILSAFE_SCHEMA }) }),
    fallback: false,
    step: "classify plugin guidance frontmatter",
  });
}

function nextFrontmatterState(required: { state: FrontmatterState; line: string; lines: readonly string[]; index: number }): FrontmatterState {
  const line = required.line.trimEnd();
  if (required.state === "body") return line === "---" && opensFrontmatter(required) ? "frontmatter" : "body";
  if (line === "---") return "body";
  if (/^allowed-tools:$/.test(line)) return "allowedTools";
  return required.state === "allowedTools" && /^\s+-\s/.test(line) ? "allowedTools" : "frontmatter";
}

/**
 * Removes a `"Bash"` item from every frontmatter `allowed-tools` list in delivered guidance. Body
 * text, examples and every other tool stay byte-identical; source files are never changed.
 * @complexity O(lines).
 */
export function removeChatRefusedToolPermissions({ text }: { text: string }, _optional: Record<string, never> = {}): string {
  const lines = text.split("\n");
  let state: FrontmatterState = "body";
  let fence: string | undefined;
  return lines.filter((line, index) => {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (state === "body" && marker) {
      // Both capture groups are required by the pattern, so a match always carries them.
      const markerFence = marker[1]!;
      const markerSuffix = marker[2]!;
      if (fence === undefined) fence = markerFence;
      else if (markerFence[0] === fence[0] && markerFence.length >= fence.length && markerSuffix.trim() === "") fence = undefined;
      return true;
    }
    if (fence !== undefined) return true;
    state = nextFrontmatterState({ state, line, lines, index });
    return !(state === "allowedTools" && REFUSED_TOOL_ITEM.test(line));
  }).join("\n");
}

/** Splits a leading notice (maturity) off the plugin's guidance so it can stay first. O(text). */
function splitNotice(required: { guidance: string }, optional: { notice?: string }): { lead?: string; body: string } {
  const { notice } = optional;
  if (notice === undefined || !required.guidance.startsWith(`${notice}\n\n`)) return { body: required.guidance };
  return { lead: notice, body: required.guidance.slice(notice.length + 2) };
}

/** What the plugin tool's handler returned, as far as the overlay needs it. */
export interface PluginToolGuidance {
  readonly pluginId: string;
  readonly guidance: string;
  readonly files?: readonly string[];
  readonly note?: string;
}

/**
 * Seam 1, the `agent_plugin_<id>` tool response. `required.result` is the plugin handler's answer —
 * for a `host/` request, the caller asked the handler WITHOUT `file`, so it is the skill's default.
 * - `file` names a host file: the guidance becomes that file; a refused name keeps the skill's
 *   guidance with `GUIDANCE.md` first, plus a note.
 * - otherwise: `GUIDANCE.md` goes before the plugin's guidance; `optional.notice` stays first.
 * Host names are appended to `files` either way.
 * @complexity Two overlay reads at most, plus O(guidance) text work.
 */
export async function deliverHostPluginGuidance(
  required: { result: PluginToolGuidance; file?: string; overlaysDir: string },
  optional: { notice?: string } = {},
): Promise<{ guidance: string; files: string[]; note?: string }> {
  const { result } = required;
  const host = await readHostPluginGuidance({ pluginId: result.pluginId, overlaysDir: required.overlaysDir });
  const files = [...(result.files ?? []), ...host.files];
  const read = required.file === undefined ? undefined : await readHostPluginFile({ pluginId: result.pluginId, file: required.file, overlaysDir: required.overlaysDir });
  const { lead, body } = splitNotice({ guidance: result.guidance }, optional);
  const parts = read && "text" in read ? [lead, read.text] : [lead, host.guidance, body];
  const guidance = parts.filter(Boolean).join("\n\n");
  const note = [result.note, read && "note" in read ? read.note : undefined].filter(Boolean).join(" ");
  return { guidance: removeChatRefusedToolPermissions({ text: guidance }), files, ...(note ? { note } : {}) };
}

/** A run-reference request, as the host's run-reference resolver receives it. */
export interface HostPluginRefOptions {
  readonly deliveryMode?: AgentPluginDeliveryMode;
  readonly allowInactiveGuidance?: boolean;
  readonly skill?: string;
  readonly file?: string;
}

/**
 * Splits a run-reference request: the owner receives everything except a `host/` file, which is
 * the host's. Pointer delivery with nothing selected stays the owner's ~400-byte pointer; its tool call
 * carries the overlay, so the guidance is not added twice.
 * @complexity O(1).
 */
export function splitHostPluginRefRequest(
  required: { options: HostPluginRefOptions; defaultDeliveryMode: AgentPluginDeliveryMode }, _optional: Record<string, never> = {},
): { ownerOptions: HostPluginRefOptions; overlay: { includeGuidance: boolean; file?: string } } {
  const { options } = required;
  const pointerOnly = (options.deliveryMode ?? required.defaultDeliveryMode) === "pointer" && options.skill === undefined && options.file === undefined;
  const { file, ...ownerOptions } = options;
  const request = { file };
  if (!isHostPluginFileRequest(request)) return { ownerOptions: options, overlay: { includeGuidance: !pointerOnly } };
  return { ownerOptions, overlay: { includeGuidance: !pointerOnly, file: request.file } };
}

/**
 * Seam 2, run references. For each pinned plugin: its `GUIDANCE.md` (unless `includeGuidance` is
 * false — pointer delivery, whose tool call carries it) and, when `file` names a host file, that
 * file framed with its plugin and name. A missing host file refuses the run, as the owner refuses a
 * missing plugin file.
 * @complexity O(refs) overlay reads.
 */
export async function readHostPluginRefOverlays(
  required: { pluginRefIds: readonly string[]; includeGuidance: boolean; file?: string; overlaysDir: string },
  _optional: Record<string, never> = {},
): Promise<{ ok: true; guidance: string[]; fileSections: string[] } | { ok: false; reason: string }> {
  const guidance: string[] = [];
  const fileSections: string[] = [];
  for (const pluginId of required.pluginRefIds) {
    const host: HostPluginGuidance = required.includeGuidance ? await readHostPluginGuidance({ pluginId, overlaysDir: required.overlaysDir }) : { files: [] };
    if (host.guidance !== undefined) guidance.push(host.guidance);
    if (required.file === undefined) continue;
    const read = await readHostPluginFile({ pluginId, file: required.file, overlaysDir: required.overlaysDir });
    if ("note" in read) return { ok: false, reason: read.note };
    fileSections.push(`Host file ${required.file} for Agent Plugin '${pluginId}':\n${read.text}`);
  }
  return { ok: true, guidance, fileSections };
}
