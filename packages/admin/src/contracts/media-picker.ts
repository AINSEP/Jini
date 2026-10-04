import { adminPort } from '../core/module/token.js';
/** Data returned across tab boundaries. Consumers need no media implementation import. */
export interface MediaAsset {
  readonly id: string;
  readonly title: string;
  readonly alt: string;
  readonly contentType: string | null;
  readonly publicUrl: string | null;
}
export interface MediaPickerPort {
  pick(
    required: { accept: readonly string[] },
    optional?: { signal?: AbortSignal },
  ): Promise<MediaAsset | null>;
}
export const mediaPickerToken = adminPort<MediaPickerPort, 'admin.media.picker'>({
  id: 'admin.media.picker',
});
