/**
 * @file The one sentence every upload surface uses when a file is over the limit, so the server, the
 * Library screen and the chat composer all say the same thing in the same words.
 */

const BYTES_PER_KB = 1024;
const BYTES_PER_MB = 1024 * 1024;

/** A size to one decimal in the unit a person reads; `roundUp` keeps an over-limit file above the limit. */
function plainSize({ bytes, roundUp }: { bytes: number; roundUp: boolean }): string {
  const round = roundUp ? Math.ceil : Math.round;
  if (bytes >= BYTES_PER_MB) return `${round((bytes / BYTES_PER_MB) * 10) / 10} MB`;
  if (bytes >= BYTES_PER_KB) return `${round((bytes / BYTES_PER_KB) * 10) / 10} KB`;
  return `${bytes} bytes`;
}

/**
 * "That file is 200 MB; the limit is 50 MB." 1024-based, like every other upload limit here.
 * The file's size is rounded UP to a tenth so a file that is only a byte over never reads as
 * "50 MB; the limit is 50 MB" (which would look like it should have been accepted).
 *
 * @param required.fileBytes - The size of the file that was refused.
 * @param required.limitBytes - The largest size this surface accepts.
 * @returns A plain-words sentence naming both sizes.
 * @complexity O(1).
 */
export function describeUploadOverLimit({ fileBytes, limitBytes }: { fileBytes: number; limitBytes: number }): string {
  return `That file is ${plainSize({ bytes: fileBytes, roundUp: true })}; the limit is ${plainSize({ bytes: limitBytes, roundUp: false })}.`;
}
