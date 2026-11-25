/**
 * The one media upload policy value: an ordinary file (image, document, small video) is admitted
 * up to 50 MiB, and a video at or under it is kept as-is rather than converted.
 */
// The eventual stored-file target is not the maximum input accepted for a convertible video.
export const MEDIA_MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
