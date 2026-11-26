import { expect, it } from 'vitest';
import { toolMetadata } from '../media-video-conversion.js';

it('preserves the descriptor approval and exchange classification', () => {
  expect(toolMetadata.media_convert_video.approval).toEqual({ class: 'edit', confirmation: 'direct' });
});
