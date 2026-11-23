import type { AgentToolDefinition as SharedAgentToolDefinition } from "@jini-ai/core";
import type { AgentToolSideEffect } from "@jini-ai/core";

/**
 * @file Agent-tool catalog for the media-import domain — closes the "the assistant is holding a URL
 * to an image and cannot save it" gap, found live 2026-09-06.
 *
 * The incident, in the assistant's own words after generating a real 2048x1152 PNG through an
 * external MCP server and being handed a CloudFront URL for it: "`media_upload_asset` needs base64
 * bytes I'm holding, `media_promote_chat_attachment` needs a chat attachment, and there is no
 * import-by-URL tool." The catalog could accept raw base64, and it could promote something a human
 * had already attached to a chat. Nothing accepted a URL — so a human had to bridge it by hand,
 * fetching the bytes in a browser and POSTing them to the admin API.
 *
 * URL and local-file imports share this domain. This is not a general
 * "fetch a URL" primitive (`custom_credential_make_request` is the tool for talking to an API), it
 * is specifically "the bytes at this URL are an image or video, put them in the media library"
 * (the host fetch-image module's `IMPORTABLE_CONTENT_TYPES`, 2026-09-07: widened from images-only to match
 * `uploadMedia`'s own accepted set, video/mp4 and video/webm included).
 *
 * A new domain rather than a 5th entry on `media`'s catalog, for the same reason
 * the media-generation domain is one: `media`'s 4-tool catalog is `@jini-ai/cms`-owned (shared across
 * every host of that package, with its own "wire the ENTIRE catalog" tripwire test on both sides),
 * while this tool's pipeline — the host's SSRF-guarded HTTP client, built by the host's own
 * composition root from the host's own egress policy — is host-specific glue. Same category
 * `custom-credentials`/`site-inspection`/`site-evidence`/`media-generation` already established.
 *
 * `media.upload`-gated — the same permission `media_upload_asset` and `media_generate_asset` use,
 * not a new one. What this tool durably DOES is create exactly the kind of row a human upload
 * creates; only the byte source differs. Reusing the existing permission also means no seed or role
 * change is needed for an existing grant to cover it.
 *
 * Architectural role: media-import domain declaration. Uses the host's injected fs-files root ids so
 * local imports cannot invent a wider root vocabulary; the host binds the catalog through
 * {@link buildMediaImportAgentToolCatalog}.
 */

/** Shared catalog contract with this domain's side-effect vocabulary. */
export type AgentToolDefinition = SharedAgentToolDefinition & { sideEffects: AgentToolSideEffect };

/** Required args for {@link buildMediaImportAgentToolCatalog}. */
export interface MediaImportAgentToolCatalogArgs {
  /** The host file browser's root ids (`fs_list_files`' own `root` vocabulary). */
  fsRootIds: readonly string[];
  /** Owner-controlled recovery for a path outside the file browser's roots; never set roots from a tool. */
  fsFolderReadRecovery: string;
}

const localImportSchema = ({ fsRootIds, fsFolderReadRecovery }: MediaImportAgentToolCatalogArgs) => ({
  type: "object",
  additionalProperties: false,
  required: ["root", "path"],
  properties: {
    root: {
      type: "string",
      enum: fsRootIds,
      description: "Use site for files in this site, or custom for the folder the owner picked with the chat composer folder button. The picked folder may be outside the site and is readable through these tools. repo and unpicked folders are refused.",
    },
    path: {
      type: "string",
      description: "File path relative to that root, as found with fs_list_files. For custom, absolute or ~/ paths inside the picked folder are also accepted. Escapes, denied filenames and secrets folders are refused. " + fsFolderReadRecovery,
    },
    title: { type: "string", description: "Optional media title; defaults to the file's name without its extension." },
    alt: { type: "string", description: "Optional accessibility alt text." },
    caption: { type: "string", description: "Optional display caption." },
  },
}) as const;

const IMPORT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["url"],
  properties: {
    url: {
      type: "string",
      description:
        "The absolute https URL of the image or video to import, including the scheme — for example " +
        "'https://cdn.example.com/generated/fox.png'. The server fetches it; you do not need to " +
        "download it yourself or hold its bytes. http, data:, file: and relative URLs are rejected, " +
        "as are URLs that resolve to a private, loopback, link-local or cloud-metadata address. " +
        "Signed or time-limited vendor URLs expire fast — import promptly rather than saving the URL for later.",
    },
    filename: {
      type: "string",
      aliases: ["title"],
      description:
        "Optional. A name for the asset, used to derive its title in the media library. Defaults to " +
        "the last path segment of the URL, which is often a meaningless hash — pass something " +
        "descriptive when you know what the file is. The file extension is always set from the " +
        "asset's real format and cannot be overridden here.",
    },
    alt: { type: "string", description: "Optional accessibility alt text for the imported asset." },
    caption: { type: "string", description: "Optional display caption for the imported asset." },
    credit: { type: "string", description: "Optional attribution/credit line for the imported asset — e.g. the vendor, photographer, or videographer it came from." },
  },
} as const;

/**
 * This domain's fixed agent-tool catalog, bound to the host's fs-files roots and recovery text.
 *
 * @complexity O(1) — a fixed, statically-defined list.
 */
export function buildMediaImportAgentToolCatalog(
  { fsRootIds, fsFolderReadRecovery }: MediaImportAgentToolCatalogArgs,
  _optional: Record<string, never> = {},
): AgentToolDefinition[] {
  const LOCAL_IMPORT_SCHEMA = localImportSchema({ fsRootIds, fsFolderReadRecovery });
  return [
    {
      name: "media_replace_file",
      description: "Replace the file bytes of an existing media item in place from an https URL or a local file. Keeps its id, slug, metadata and all page references; increments its version and refreshes its /m/ renditions, just like Replace file in Admin Media. Use this when the owner wants a different image under the same media entry, rather than creating another entry. Pass mediaId and either url or root plus path (the same roots as fs_list_files). Returns {media:{id,slug,version,sha256,publicUrl}}. Requires media.update. Refuses trashed items, concurrent edits, unavailable replacement storage, unsafe URLs or paths, and oversized or unsupported bytes. No deletion confirmation is needed.",
      sideEffects: "mutates-durable-state",
      authorization: { permission: "media.update" },
      inputSchema: {
        type: "object", additionalProperties: false, required: ["mediaId"],
        properties: {
          mediaId: { type: "string", minLength: 1 },
          url: IMPORT_SCHEMA.properties.url,
          root: LOCAL_IMPORT_SCHEMA.properties.root,
          path: LOCAL_IMPORT_SCHEMA.properties.path,
        },
        oneOf: [{ required: ["url"], not: { anyOf: [{ required: ["root"] }, { required: ["path"] }] } },
          { required: ["root", "path"], not: { required: ["url"] } }],
      },
    },
    {
      name: "media_import_local_file",
      description:
        "Put an image or video saved in this site or the owner-picked folder into the media library. Find the file with fs_list_files first, then pass the same root and relative path that fs_read_file takes. Use site for a logo in a theme folder, or custom for assets in the folder picked from the chat composer. For an https link use media_import_from_url. Accepts PNG, JPEG, GIF, WebP, AVIF, SVG, MP4 and WebM, up to 50 MiB, detected from the actual bytes. SVG is sanitized before storage; SVG fonts are refused. Returns { media: ImportedMediaView }, the same media object as media_import_from_url (id, slug, title, alt, caption, credit, sha256, status, version, publicUrl, sourceUrl); sourceUrl is empty for local files. Identical bytes share one stored blob. Unpicked folders, secrets, denied files, and oversized or unsupported files are refused. " + fsFolderReadRecovery,
      sideEffects: "mutates-durable-state",
      authorization: { permission: "media.upload" },
      inputSchema: LOCAL_IMPORT_SCHEMA,
    },
    {
      name: "media_import_from_url",
      description:
        "THIS IS HOW TO SAVE AN IMAGE OR VIDEO YOU ONLY HAVE A URL FOR — the missing third way into the media library, alongside media_upload_asset (which needs base64 bytes you are already holding) and media_promote_chat_attachment (which needs a file a human attached to this chat). Call this whenever you have a link to an image or video and want it in the media library: an image another tool or an external MCP server just generated and returned a URL for, an image on a page you are working from, a stock/CDN image or video clip the human pointed you at. You do NOT need to download the file, read it, or convert it to base64 first — pass the URL and the server fetches the bytes itself. Requires an absolute https URL; the fetch is size-bounded, time-bounded, and blocked from reaching private/internal addresses. The file's real format is detected from its actual bytes, not from what the server claims, and only PNG, JPEG, GIF, WebP, AVIF, SVG, MP4 and WebM are accepted — SVG is sanitized before storage; a URL that returns HTML or a PDF is rejected rather than saved as a broken asset. On success the returned `media` object (id, title, alt, caption, credit, sha256, status, version, publicUrl) is the SAME shape media_upload_asset/media_generate_asset/content_read.media_asset return, so the id can go straight into media_update_metadata/media_trash_asset and `publicUrl` (when present) can be used to embed the asset in a post or page immediately. Importing the same file twice is safe and cheap — identical bytes are de-duplicated to one stored blob. A 403 or 404 usually means a signed URL has already expired: ask for a fresh URL instead of retrying the same one.",
      sideEffects: "mutates-durable-state",
      authorization: { permission: "media.upload" },
      inputSchema: IMPORT_SCHEMA,
    },
  ];
}
