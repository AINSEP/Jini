import type { StoredAttachment, AttachmentClaim } from './attachment-types.js';
import { realpath, mkdtemp, rm, chmod, copyFile } from 'node:fs/promises';
import { resolve, basename } from 'node:path';


// Only objects returned by this store's claim() carry aliases. Weak keys keep this staging bridge
// private without extending the wire/persisted formats or retaining completed claims indefinitely.
export const stagedPathsByAttachment = new WeakMap<StoredAttachment, Set<string>>();

/** Copy an already authenticated claim into the host's filesystem boundary. Keep the original
 * store records intact for promotion/read-back; the caller owns cleanup after the run ends.
 * Only claimed files are copied, never batch sidecars or another upload's capability ids.
 * Exact staged paths alias the original store record until cleanup revokes them.
 * O(b) I/O for b claimed bytes, bounded by the attachment store's batch limits. Partial copies
 * are removed before rejection. The temporary directory is private and directly under real root.
 */
export async function stageAttachmentClaim(required: { claim: AttachmentClaim; filesystemRoot: string }, _optional = {}): Promise<{
  claim: AttachmentClaim; cleanup: () => Promise<void>;
}> {
  const root = await realpath(required.filesystemRoot);
  const directory = await mkdtemp(resolve(root, '.agent-attachments-'));
  const stagedAliases = new Map<string, Set<string>>();
  const cleanup = async () => {
    for (const [path, aliases] of stagedAliases) aliases.delete(path);
    await rm(directory, { recursive: true, force: true });
  };
  try {
    await chmod(directory, 0o700);
    const attachments: StoredAttachment[] = [];
    for (const attachment of required.claim.attachments) {
      const target = resolve(directory, basename(attachment.path));
      await copyFile(attachment.path, target);
      await chmod(target, 0o600);
      attachments.push({ ...attachment, path: target });
      const aliases = stagedPathsByAttachment.get(attachment);
      if (aliases) {
        aliases.add(target);
        stagedAliases.set(target, aliases);
      }
    }
    return { claim: { attachments, batchDirectory: directory }, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
