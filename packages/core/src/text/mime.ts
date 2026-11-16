/** @file Maps a MIME type to the file extension used when a pasted file arrives without a name. */

export function extensionForMimeType(mimeType: string): string {
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'image/jpeg') return '.jpg';
  if (mimeType === 'image/gif') return '.gif';
  if (mimeType === 'image/webp') return '.webp';
  if (mimeType === 'image/avif') return '.avif';
  if (mimeType === 'image/svg+xml') return '.svg';
  if (mimeType === 'text/html') return '.html';
  if (mimeType === 'text/plain') return '.txt';
  return '';
}
