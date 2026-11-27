import { expect, it } from 'vitest';
import { MEDIA_UPLOAD_TOO_LARGE } from '../cms-media.js';
import { MEDIA_PROVIDER_CONTRACT_ID } from '../media-provider-contribution.js';
import { MEDIA_MAX_UPLOAD_BYTES } from '../media-upload-limits.js';

it('keeps the media provider registration key and oversized-upload refusal code stable on the wire', () => {
  expect(MEDIA_PROVIDER_CONTRACT_ID).toBe('media');
  expect(MEDIA_UPLOAD_TOO_LARGE).toBe('MEDIA_UPLOAD_TOO_LARGE');
});

it('publishes the ordinary file ceiling as exactly 50 MiB in bytes', () => {
  expect(MEDIA_MAX_UPLOAD_BYTES).toBe(52_428_800);
});
