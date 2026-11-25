import { ToolInputError, requireInputRecord } from '@jini-ai/core';
import { CHAT_ATTACHMENT_REF_PATTERN } from '@jini-ai/core/contracts/headless/chat-attachment';
import { type PluginInstallRequest, type InstallAttachmentReader, type InstallArchiveFiles } from '@jini-ai/core/contracts/headless/plugin-install-source';

export function readPluginInstallRequest(
  { input: rawInput, isAbsolutePath, absolutePathMessage }: { input: unknown; isAbsolutePath(required: { path: string }, optional?: Record<string, never>): boolean; absolutePathMessage: string },
  _optional: Record<string, never> = {},
): PluginInstallRequest {
  const input = requireInputRecord({ input: rawInput });
  if (!input.source || typeof input.source !== "object" || Array.isArray(input.source)) throw new ToolInputError({ message: "source is required." });
  const source = input.source as Record<string, unknown>;
  const { kind, path: sourcePath, attachmentRef } = source;
  if (kind !== "folder" && kind !== "zip") throw new ToolInputError({ message: "source.kind must be 'folder' or 'zip'." });
  const location = validateInstallLocation({ source, kind, sourcePath, attachmentRef, isAbsolutePath, absolutePathMessage });
  if (input.replace !== undefined && typeof input.replace !== "boolean") throw new ToolInputError({ message: "replace must be a boolean." });
  return { kind, ...location, replace: input.replace === true };
}

/** Bound reads BEFORE allocation; never interpret an opaque attachment id as a filesystem path. */
export async function readPluginInstallArchive(
  required: { request: PluginInstallRequest; ownerId: string; runId: string; maxBytes: number; files: InstallArchiveFiles; messages: { attachmentUnavailable: string; tooLarge: string; noReadableZip(required: { path: string }, optional?: Record<string, never>): string } },
  optional: { readAttachment?: InstallAttachmentReader } = {},
): Promise<Uint8Array> {
  const { request, ownerId, runId, maxBytes, files, messages } = required;
  if (request.attachmentRef) {
    const result = await optional.readAttachment?.({ ref: request.attachmentRef, ownerId, runId }, { maxBytes });
    if (!result?.ok) throw new ToolInputError({ message: messages.attachmentUnavailable });
    requireArchiveSize({ size: result.bytes.byteLength, maxBytes, tooLarge: messages.tooLarge });
    return result.bytes;
  }
  const sourcePath = request.path;
  if (sourcePath === undefined) throw new ToolInputError({ message: "Plugin ZIP source has no path." });
  let size: number;
  try { size = (await files.stat({ path: sourcePath })).size; } catch { throw new ToolInputError({ message: messages.noReadableZip({ path: sourcePath }) }); }
  requireArchiveSize({ size, maxBytes, tooLarge: messages.tooLarge });
  const bytes = await files.read({ path: sourcePath });
  // Re-check in case the local file grew between stat and read.
  requireArchiveSize({ size: bytes.byteLength, maxBytes, tooLarge: messages.tooLarge });
  return bytes;
}

function validateInstallLocation(
  { source, kind, sourcePath, attachmentRef, isAbsolutePath, absolutePathMessage }: { source: Record<string, unknown>; kind: "folder" | "zip"; sourcePath: unknown; attachmentRef: unknown; isAbsolutePath(required: { path: string }, optional?: Record<string, never>): boolean; absolutePathMessage: string },
  _optional: Record<string, never> = {},
): { path: string } | { attachmentRef: string } {
  if (Object.hasOwn(source, "path") === Object.hasOwn(source, "attachmentRef")) throw new ToolInputError({ message: "Exactly one of source.path/source.attachmentRef is required." });
  if (Object.hasOwn(source, "attachmentRef")) {
    if (kind !== "zip" || typeof attachmentRef !== "string" || !CHAT_ATTACHMENT_REF_PATTERN.test(attachmentRef)) throw new ToolInputError({ message: "source.attachmentRef must be an attachment:<uuid> ZIP reference." });
    return { attachmentRef };
  } else {
    if (typeof sourcePath !== "string" || !isAbsolutePath({ path: sourcePath })) throw new ToolInputError({ message: absolutePathMessage });
    return { path: sourcePath };
  }
}

function requireArchiveSize({ size, maxBytes, tooLarge }: { size: number; maxBytes: number; tooLarge: string }, _optional: Record<string, never> = {}): void {
  if (size > maxBytes) throw new ToolInputError({ message: tooLarge });
}
