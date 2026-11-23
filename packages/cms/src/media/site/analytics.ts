import type { Tracker } from "@jini-ai/core/contracts/site/diagnostics-observability";

/** Fixed size labels for the CMS upload event; never filenames, hashes or byte contents.
 * @complexity O(1). */
function uploadBytesBucket({ byteLength }: { byteLength: number }, _optional = {}): string {
  if (byteLength < 100_000) return "<100KB";
  if (byteLength < 1_000_000) return "<1MB";
  return byteLength < 10_000_000 ? "<10MB" : "10MB+";
}

/** Called after the shared upload owner and host type bookkeeping succeed. No provider details leave.
 * @complexity O(1). */
export function captureMediaUploaded(
  { tracker, actorId, byteLength, kind, source }: { tracker?: Tracker; actorId: string; byteLength: number;
    kind: "image" | "audio" | "video" | "document" | "other"; source: "admin" | "assistant" | "service" },
  _optional: Record<string, never> = {},
): void {
  try { void tracker?.capture({ name: "media_uploaded", userId: actorId }, { properties: {
    kind, bytesBucket: uploadBytesBucket({ byteLength }), source,
  } }); } catch { /* Product analytics cannot fail a completed upload. */ }
}
