import type { AgentToolDefinition as SharedAgentToolDefinition } from "@jini-ai/core";

import { FS_FILES_CUSTOM_ROOT_MANAGE_PERMISSION } from "./custom-root-permission.js";

/**
 * @file The `fs-files` domain's agent-tool catalog: the read-only `fs_list_files` and `fs_read_file`,
 * plus the carded picked-folder batch write `fs_write_files`.
 *
 * Purpose:
 * Gives the assistant guarded filesystem reads (for example an installed plugin's bundled reference
 * templates, which no domain store exposes) and one write path into the owner-picked folder.
 *
 * Why the roots are arguments:
 * Which named roots exist (`site`, `custom`, a whole install tree, ...) and how each is described is
 * the host's layout decision, not the package's. The host passes its root IDs, their descriptions and
 * its read ceiling; the root-dependent schema is built per call, so two hosts never share a list.
 *
 * Why read-only except for one carded batch:
 * Nothing downstream re-validates a file written under an arbitrary root, so the only write is
 * `fs_write_files` into the picked folder, approved as one batch on one card that lists every file —
 * the human reviewing the exact bytes is the validator. `FS_WRITE_LIMITS` is the single bound both the
 * published schema and the writer in `write-files.ts` enforce, so they cannot drift.
 *
 * How it relates to the project:
 * A server-side tool filter consumes this catalog to decide which tool names a session may see;
 * `authorize()` enforces the permissions at call time. This module performs no I/O and no enforcement.
 */

export type AgentToolSideEffect = "none" | "mutates-durable-state" | "deletes-durable-state" | "mints-token";

export type AgentToolDefinition = SharedAgentToolDefinition;

/**
 * Reused, not invented: `content.read` already gates the other read-only, cross-domain tools with no
 * single owning resource. A principal who may read this workspace's content and configuration may
 * read the directories the host exposes here, for the same reason.
 */
export const FS_FILES_READ_PERMISSION = "content.read";

/** Bounds of one `fs_write_files` batch: the schema publishes them and the writer enforces them. */
export const FS_WRITE_LIMITS = { maxFiles: 50, maxFileBytes: 2 * 1024 * 1024, maxTotalBytes: 10 * 1024 * 1024 } as const;

export const FS_LIST_FILES_TOOL_ID = "fs_list_files";
export const FS_READ_FILE_TOOL_ID = "fs_read_file";
export const FS_WRITE_FILES_TOOL_ID = "fs_write_files";

/** One host root as the model sees it: the enum value and what lives there. */
export interface FsFilesRootDescriptor {
  readonly id: string;
  readonly description: string;
}

/** What a host supplies to build its catalog: its root IDs, their descriptions, and its read ceiling. */
export interface FsFilesAgentToolCatalogInput {
  readonly rootIds: readonly string[];
  readonly rootDescriptors: readonly FsFilesRootDescriptor[];
  readonly maxFileBytes: number;
}

const RELATIVE_PATH_PROPERTY = {
  type: "string",
  minLength: 1,
  description:
    "A path relative to the chosen root, e.g. 'site-compliance/references/checklist.md'. For custom, an absolute or ~/ path inside the picked folder is also accepted. Paths escaping the selected root, including through symbolic links, are refused.",
} as const;

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

const LIST_FILES_DESCRIPTION =
  "Lists immediate files and directories under one allowed root or path, relative to the requested directory; directories end in '/'. Read-only. Defaults to depth 1, at most 100 entries and an 8KB output budget. Use path to browse a directory, depth to expand, or recursive:true for a recursive listing (up to depth 12), always with paging. Partial results carry truncated:true and a 'truncated: N more entries' message; send nextCursor as cursor with the same root/path/depth/recursive to continue. If the traversal budget is reached the remainder is unknown: narrow path to inspect unscanned directories. A filename absent from a partial or shallow listing is not evidence that it is missing or empty. An empty complete result means no visible entries, or the requested directory does not exist yet. Secrets folders, denied filenames (databases, .env, private keys/certs), symlinks, node_modules, .git and dist are excluded. Use this to discover shipped files before fs_read_file rather than guessing filenames.";

const MIB = 1024 * 1024;

/**
 * Builds the root-dependent list/read schemas from the host's roots.
 *
 * @complexity O(r) in the number of root descriptors.
 */
function rootSchemas({ rootIds, rootDescriptors }: Pick<FsFilesAgentToolCatalogInput, "rootIds" | "rootDescriptors">, _optional = {}) {
  const enumDescription = rootDescriptors.map(root => `'${root.id}': ${root.description}`).join(" | ");
  const root = { type: "string", enum: [...rootIds], description: `Which allowed root to look inside. One of: ${enumDescription}` };
  const list = {
    type: "object",
    additionalProperties: false,
    required: ["root"],
    properties: {
      root,
      path: { ...RELATIVE_PATH_PROPERTY, description: "Optional subdirectory within the root to list, e.g. 'site-compliance'. Omit to list from the root itself." },
      depth: { type: "integer", minimum: 1, maximum: 12, description: "Levels to list, default 1 (immediate files and directories). Overrides recursive. Directories at the depth boundary end in '/'." },
      recursive: { type: "boolean", description: "Explicit recursive listing, up to depth 12. Results are still paged; default false." },
      limit: { type: "integer", minimum: 1, maximum: 100, clamp: true, description: "Maximum entries per page, default 100. The 8KB output budget may return fewer entries." },
      cursor: { type: "string", pattern: "^(0|[1-9][0-9]*)$", description: "Use the previous nextCursor with the same root/path/depth/recursive. Restart if the directory changes." },
    },
  };
  const read = { type: "object", additionalProperties: false, required: ["root", "path"], properties: { root, path: RELATIVE_PATH_PROPERTY } };
  return { list, read };
}

/**
 * The `fs-files` domain's agent-tool catalog for one host's roots and read ceiling.
 *
 * @complexity O(r) in the number of root descriptors.
 */
export function getFsFilesAgentToolCatalog({ rootIds, rootDescriptors, maxFileBytes }: FsFilesAgentToolCatalogInput, _optional = {}): AgentToolDefinition[] {
  const schemas = rootSchemas({ rootIds, rootDescriptors });
  return [
    { name: FS_LIST_FILES_TOOL_ID, description: LIST_FILES_DESCRIPTION, sideEffects: "none", authorization: { permission: FS_FILES_READ_PERMISSION }, inputSchema: schemas.list },
    {
      name: FS_READ_FILE_TOOL_ID,
      description: `Reads one file's raw text content from inside an allowed directory root. Read-only. Refused for: a path escaping the root (including through a symbolic link), a path with a 'secrets' folder anywhere in it, a path matching a denied filename pattern (databases, .env files, private keys/certs), a file larger than ${maxFileBytes} bytes, or a file that sniffs as binary (this tool reads text only).`,
      sideEffects: "none",
      authorization: { permission: FS_FILES_READ_PERMISSION },
      inputSchema: schemas.read,
    },
    {
      name: FS_WRITE_FILES_TOOL_ID,
      description: `Creates or replaces files in the folder the user picked (the 'custom' root, outside the site) — the only way to write there. Put every file of one change in ONE call: the user approves the whole batch on one card listing each file, and nothing is written if they decline. At most ${FS_WRITE_LIMITS.maxFiles} files, ${FS_WRITE_LIMITS.maxFileBytes / MIB} MiB each, ${FS_WRITE_LIMITS.maxTotalBytes / MIB} MiB per call. Refused for the same paths fs_read_file refuses (secrets, .env, keys, databases) and for any path through a symbolic link. The result lists written, failed and notWritten files; on a failure it stops, and files already written stay.`,
      sideEffects: "mutates-durable-state",
      authorization: { permission: FS_FILES_CUSTOM_ROOT_MANAGE_PERMISSION },
      inputSchema: WRITE_FILES_SCHEMA,
    },
  ];
}
