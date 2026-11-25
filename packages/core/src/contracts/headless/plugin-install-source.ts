/** Chat attachment input belongs to the host contract, shared by both plugin families. */
import type { ChatAttachmentReadResult } from '@jini-ai/core/contracts/headless/chat-attachment';

/** Host-owned byte access: composition scopes opaque refs by principal and accepted message/run. */
export type InstallAttachmentReader = (
  required: { ref: string; ownerId: string; runId: string },
  optional: { maxBytes: number },
) => Promise<ChatAttachmentReadResult>;

export interface PluginInstallRequest { readonly kind: "folder" | "zip"; readonly path?: string; readonly attachmentRef?: string; readonly replace: boolean }

/** Composition supplies the shared source reader so plugin families do not load each other. */
export interface PluginInstallSourcePort {
  readRequest(required: { input: unknown }, optional?: Record<string, never>): PluginInstallRequest;
  readArchive(
    required: { request: PluginInstallRequest; ownerId: string; runId: string; maxBytes: number },
    optional?: { readAttachment?: InstallAttachmentReader; files?: InstallArchiveFiles },
  ): Promise<Uint8Array>;
}

export interface InstallArchiveFiles {
  stat(required: { path: string }, optional?: Record<string, never>): Promise<{ size: number }>;
  read(required: { path: string }, optional?: Record<string, never>): Promise<Uint8Array>;
}
