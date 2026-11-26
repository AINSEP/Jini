import type { AdminMedia } from "@jini-ai/core/contracts/site/cms-admin-media";

/** The card note for a video Chrome may refuse to play (its key is the English text). */
const CHROME_PLAYBACK_NOTE = "This video may not play in Chrome.";

/** Whether a card shows {@link CHROME_PLAYBACK_NOTE}: a probed HEVC video at or under the ordinary limit,
 *  which is stored as-is (a larger one is converted). @complexity O(1). */
export function showsChromePlaybackNote({ item, maxUploadBytes }: { item: Pick<AdminMedia, "videoCodec" | "byteSize">; maxUploadBytes: number }, _optional: Record<string, never> = {}): boolean {
  // Compatibility depends on the codec, not the filename or container.
  return item.videoCodec === "hevc" && typeof item.byteSize === "number" && item.byteSize <= maxUploadBytes;
}

/** The muted card note under a card's metadata row, or nothing when the video plays everywhere. */
export function ChromePlaybackNote(props: { item: Pick<AdminMedia, "videoCodec" | "byteSize">; t: (key: string) => string; maxUploadBytes: number }, _optional = {}) {
  return showsChromePlaybackNote({ item: props.item, maxUploadBytes: props.maxUploadBytes }) ? <p className="media-card-note">{props.t(CHROME_PLAYBACK_NOTE)}</p> : null;
}
