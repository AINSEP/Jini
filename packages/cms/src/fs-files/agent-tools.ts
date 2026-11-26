import type { AgentToolDefinition as SharedAgentToolDefinition } from "@jini-ai/core";
import { FS_FILES_CUSTOM_ROOT_MANAGE_PERMISSION } from "@jini-ai/cms/fs-files/custom-root-permission";
import { FS_WRITE_LIMITS } from "@jini-ai/cms/fs-files/write-files";

/**
 * @file The `fs-files` domain's agent-tool catalog: two read-only tools, `fs_list_files` and
 * `fs_read_file`, plus the carded picked-folder batch write `fs_write_files`, instantiating SPEC-016 REQ-22's naming/callability convention (the same shape
 * `theme/agent-tools.ts`, `site-evidence/agent-tools.ts`, and every other domain catalog already
 * use).
 *
 * Purpose:
 * Today the assistant has NO filesystem access at all — every existing read-oriented tool
 * (`theme_read_file`, `content_read.*`, `custom_credential_make_request`) reads through a
 * domain-specific store, never a raw path. The concrete bug this closes: an Agent Plugin's own
 * bundled `references/*.template.*` files (shipped alongside its `SKILL.md`/manifest, meant to be
 * read and adapted by the agent installing it) are unreachable, because nothing exposes a plugin's
 * own directory to the model that is supposed to use it.
 *
 * ## Site-agent boundary (2026-10-23 owner decision, supersedes September 10 for these callers)
 *
 * Historical rule (superseded for picked folders by owner s5, 2026-10-29): site-agent execution
 * refused `repo`, outside `custom` roots, and other-site selectors. The persisted owner-picked
 * `custom` folder now grants read access outside the site; repo and other-site selectors remain
 * refused. All reads still use Jini's guarded reader and the secret denylist.
 * The historical rationale below is retained to explain why the broader roots still exist.
 *
 * ## Historical default-allow with a denylist (2026-09-10 owner decision)
 *
 * This domain shipped (commit `68d7e525`) as a five-member named-root allowlist scoped to
 * `<site>/agent-plugins`, `<site>/themes`, `<site>/skills`, `<site>/uploads`, and the bundled
 * `content/agent-plugins` — with everything else structurally unreachable, including the site
 * directory itself (`chat.db`, `content.db`) and the repo. The product owner reversed that: her call
 * is default-allow — the assistant should be able to read most of the repo/site tree without anyone
 * pre-listing a root — with the real boundary moved onto an explicit denylist of what must never be
 * read.
 *
 * `layout.ts`'s roots are now deliberately broad, not curated:
 * - `repo` — this installation's whole repository/product tree, outside the active site.
 * - `site` — THIS site's entire data folder, including `chat.db`/`content.db`/`config.json`/`ops/`,
 *   not merely its `agent-plugins`/`themes`/`skills`/`uploads` subdirectories as before.
 * - `custom` — an operator-set folder anywhere on the machine, unrelated to this repo or site;
 *   `undefined`/refused until an operator sets one from the chat composer (`layout.ts`'s own header).
 *
 * `fs-files.ts`'s `FS_FILES_DENYLIST` is now the PRIMARY gate, not defense in depth underneath an
 * allowlist: any path with a `secrets` segment at any depth, `.env`/`.env.*`, `*.pem`/`*.key`/`*.p12`,
 * and `*.db`/`*.db-wal`/`*.db-shm` are refused wherever they appear, regardless of root. That last
 * pattern is doing real work it did not used to have to do: `chat.db`/`content.db` are no longer kept
 * out by LOCATION (the site directory was never a root before), only by this pattern plus the binary
 * sniff — read `fs-files.ts`'s own header for the full argument and what that trade costs.
 * `node_modules`/`.git`/build output are excluded from `fs_list_files` listings for ergonomics only
 * (`fs-files.ts`'s `EXCLUDED_LISTING_DIR_NAMES`) — not part of the security boundary, and a direct
 * `fs_read_file` call into one of them is not refused.
 *
 * ## Why read-only, and why no write/edit/delete/rename tool exists in this domain
 *
 * Unlike `theme_write_file` (whose safety argument is "every theme file is re-validated by
 * `loadTheme` on every write, regardless of who wrote it" — see `theme/agent-tools.ts`'s own
 * header), NOTHING downstream of a write through an arbitrary path under either root re-validates
 * anything: a `<site>/agent-plugins/<id>/mcp.json` edited in place is not re-checked against the
 * Agent Plugins manifest schema the way a theme template is re-checked against the Liquid/Handlebars
 * allowlists. Granting write access here would be granting unvalidated, unaudited mutation of
 * installed-plugin manifests, theme source (already covered, more safely, by `theme_write_file`),
 * the site's uploaded media, and now the whole repository — with no load-bearing check to catch a
 * mistake. This slice is therefore READ-ONLY by design, not by omission: `fs_list_files`/
 * `fs_read_file` are the entire catalog, and a future write/edit/delete/rename tool in this domain is
 * a new, separately-reviewed decision, not a natural extension of this one.
 *
 * That decision (owner 2026-10-27): `fs_write_files` writes ONLY into the owner-picked folder outside
 * the site, as one batch the human approves on one card that lists every file — the human reviewing
 * the exact bytes is the validator the paragraph above says is otherwise missing. No other root is
 * writable through this domain.
 *
 * How it relates to the project:
 * The server-side tool filter (ADR-014) consumes this catalog to decide which tool names an agent
 * session may even see; `authorize()` (ADR-021 §2) enforces the actual permission checks at call
 * time — this module only declares the catalog shape, it performs no I/O and no enforcement itself.
 *
 * Architectural role:
 * `fs-files` feature domain. Imports only its own domain's constants (`fs-files.ts`'s byte ceiling,
 * `layout.ts`'s root ids), so the published JSON Schemas cannot drift from the validators — same
 * discipline `theme/agent-tools.ts`/`redirects/agent-tools.ts` already use.
 */

export type AgentToolSideEffect = "none" | "mutates-durable-state" | "deletes-durable-state" | "mints-token";

export type AgentToolDefinition = SharedAgentToolDefinition;

/**
 * Reused, not invented: `content.read` already gates every other read-only, cross-domain tool with
 * no single natural "owning" resource — `site_collect_page_evidence`, `site_get_profile`,
 * `content_post_list`/`content_post_get`. A principal who may read this workspace's content and
 * configuration may read the fixed set of directories this domain exposes, for the identical reason
 * `site-inspection/agent-tools.ts`'s own header gives for reusing it there.
 */


const WRITE_FILES_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["files"],
  properties: {
    files: {
      type: "array",
      minItems: 1,
      maxItems: FS_WRITE_LIMITS.maxFiles,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "content"],
        properties: {
          path: { type: "string", minLength: 1, description: "Path relative to the picked folder, '/'-separated, e.g. 'css/site.css'. No '..', no leading '/'." },
          content: { type: "string", description: "The whole file: text, or base64 when encoding is 'base64'." },
          encoding: { type: "string", enum: ["utf8", "base64"], description: "'utf8' (default) for text; 'base64' for binary files such as images." },
        },
      },
    },
  },
} as const;

export const FS_LIST_FILES_TOOL_ID = "fs_list_files";
export const FS_READ_FILE_TOOL_ID = "fs_read_file";
export const FS_WRITE_FILES_TOOL_ID = "fs_write_files";

/**
 * The `fs-files` domain's fixed agent-tool catalog.
 *
 * @complexity O(1) — a fixed, statically-defined list.
 */
export function getFsFilesAgentToolCatalog(required: {
  FS_ROOT_IDS: readonly string[]; FS_ROOT_DESCRIPTORS: readonly { id: string; description: string }[];
  MAX_FS_FILE_BYTES: number; FS_FILES_READ_PERMISSION: string;
}, _optional = {}): AgentToolDefinition[] {
  const { FS_ROOT_IDS, FS_ROOT_DESCRIPTORS, MAX_FS_FILE_BYTES, FS_FILES_READ_PERMISSION } = required;
const ROOT_ENUM_DESCRIPTION = FS_ROOT_DESCRIPTORS.map((r) => `'${r.id}': ${r.description}`).join(" | ");

const ROOT_PROPERTY = {
  type: "string",
  enum: FS_ROOT_IDS,
  description: `Which allowed root to look inside. One of: ${ROOT_ENUM_DESCRIPTION}`,
} as const;

const RELATIVE_PATH_PROPERTY = {
  type: "string",
  minLength: 1,
  description:
    "A path relative to the chosen root, e.g. 'site-compliance/references/checklist.md'. For custom, an absolute or ~/ path inside the picked folder is also accepted. Paths escaping the selected root, including through symbolic links, are refused.",
} as const;

const LIST_FILES_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["root"],
  properties: {
    root: ROOT_PROPERTY,
    path: {
      ...RELATIVE_PATH_PROPERTY,
      description: "Optional subdirectory within the root to list, e.g. 'site-compliance'. Omit to list from the root itself.",
    },
    depth: { type: "integer", minimum: 1, maximum: 12, description: "Levels to list, default 1 (immediate files and directories). Overrides recursive. Directories at the depth boundary end in '/'." },
    recursive: { type: "boolean", description: "Explicit recursive listing, up to depth 12. Results are still paged; default false." },
    limit: { type: "integer", minimum: 1, maximum: 100, clamp: true, description: "Maximum entries per page, default 100. The 8KB output budget may return fewer entries." },
    cursor: { type: "string", pattern: "^(0|[1-9][0-9]*)$", description: "Use the previous nextCursor with the same root/path/depth/recursive. Restart if the directory changes." },
  },
} as const;

const READ_FILE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["root", "path"],
  properties: { root: ROOT_PROPERTY, path: RELATIVE_PATH_PROPERTY },
} as const;


  return [
    {
      name: FS_LIST_FILES_TOOL_ID,
      description:
        "Lists immediate files and directories under one allowed root or path, relative to the requested directory; directories end in '/'. Read-only. Defaults to depth 1, at most 100 entries and an 8KB output budget. Use path to browse a directory, depth to expand, or recursive:true for a recursive listing (up to depth 12), always with paging. Partial results carry truncated:true and a 'truncated: N more entries' message; send nextCursor as cursor with the same root/path/depth/recursive to continue. If the traversal budget is reached the remainder is unknown: narrow path to inspect unscanned directories. A filename absent from a partial or shallow listing is not evidence that it is missing or empty. An empty complete result means no visible entries, or the requested directory does not exist yet. Secrets folders, denied filenames (databases, .env, private keys/certs), symlinks, node_modules, .git and dist are excluded. Use this to discover shipped files before fs_read_file rather than guessing filenames.",
      sideEffects: "none",
      authorization: { permission: FS_FILES_READ_PERMISSION },
      inputSchema: LIST_FILES_SCHEMA,
    },
    {
      name: FS_READ_FILE_TOOL_ID,
      description: `Reads one file's raw text content from inside an allowed directory root. Read-only. Refused for: a path escaping the root (including through a symbolic link), a path with a 'secrets' folder anywhere in it, a path matching a denied filename pattern (databases, .env files, private keys/certs), a file larger than ${MAX_FS_FILE_BYTES} bytes, or a file that sniffs as binary (this tool reads text only).`,
      sideEffects: "none",
      authorization: { permission: FS_FILES_READ_PERMISSION },
      inputSchema: READ_FILE_SCHEMA,
    },
    {
      name: FS_WRITE_FILES_TOOL_ID,
      description: `Creates or replaces files in the folder the user picked (the 'custom' root, outside the site) — the only way to write there. Put every file of one change in ONE call: the user approves the whole batch on one card listing each file, and nothing is written if they decline. At most ${FS_WRITE_LIMITS.maxFiles} files, 2 MiB each, 10 MiB per call. Refused for the same paths fs_read_file refuses (secrets, .env, keys, databases) and for any path through a symbolic link. The result lists written, failed and notWritten files; on a failure it stops, and files already written stay.`,
      sideEffects: "mutates-durable-state",
      authorization: { permission: FS_FILES_CUSTOM_ROOT_MANAGE_PERMISSION },
      inputSchema: WRITE_FILES_SCHEMA,
    },
  ];
}
