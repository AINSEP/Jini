import { Buffer } from 'node:buffer';

export interface MessageAttachmentImage {
  readonly mimeType: string;
  readonly data: string;
}
export interface MessageAttachmentSource {
  readonly name: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
  readonly path?: string;
}
export interface MessageAttachmentReader {
  (required: { ref: string }, optional: Record<string, never>): Promise<MessageAttachmentSource>;
}

/** One byte-bearing message path for CLI and API consumers. The host reader owns authorization,
 * integrity and MIME sniffing; this module never opens a caller-selected path itself. Unsupported
 * files are explicit so the model cannot mistake a filename for content it has received. */
export async function prepareMessageAttachments(
  { refs, read }: { refs: readonly string[]; read: MessageAttachmentReader },
  { fileAccess = false, imageAccess = true }: { fileAccess?: boolean; imageAccess?: boolean } = {},
): Promise<{ images: MessageAttachmentImage[]; imagePaths: string[]; notice: string }> {
  const images: MessageAttachmentImage[] = [];
  const notices: string[] = [];
  const imagePaths: string[] = [];
  for (const ref of refs) {
    const source = await read({ ref }, {});
    if (['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(source.mimeType)) {
      if (!imageAccess) {
        notices.push(`${source.name}: image attachments are unsupported by this runtime.`);
        continue;
      }
      if (source.path) imagePaths.push(source.path);
      images.push({ mimeType: source.mimeType, data: Buffer.from(source.bytes).toString('base64') });
      continue;
    }
    const video = source.mimeType.startsWith('video/');
    if (fileAccess && source.path) {
      notices.push(video
        ? `${source.name}: video attachments are unsupported by this runtime; the file is available at ${source.path}.`
        : `${source.name}: read the attached file at ${source.path}.`);
    } else {
      notices.push(`${source.name}: ${video ? 'video' : 'file'} attachments are unsupported by this runtime.`);
    }
  }
  return { images, imagePaths, notice: notices.length ? `\n\nAttachments to this message:\n${notices.join('\n')}` : '' };
}

/** Stream-JSON runtimes use the same normalized pixels as provider APIs. */
export function messageContentWithImages(
  { prompt, images }: { prompt: string; images: readonly MessageAttachmentImage[] }, _optional = {},
) {
  return [
    { type: 'text' as const, text: prompt },
    ...images.map(image => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: image.mimeType, data: image.data } })),
  ];
}
