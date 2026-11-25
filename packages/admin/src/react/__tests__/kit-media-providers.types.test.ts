import { expectTypeOf, it } from 'vitest';
import type { MediaProviderFields as UiFields, MediaProviderRowsPort as UiRowsPort } from '@jini-ai/ui/core';
import type { MediaProviderEditPatch, MediaProviderRowsPort } from '../kit-media-providers.js';

// The admin package keeps local copies of the editor's media-provider shapes so its published types pin
// no UI library. These assertions keep the copies interchangeable with the editor the host injects.
it('keeps the local rows port interchangeable with the editor rows port', () => {
  expectTypeOf<MediaProviderRowsPort>().toEqualTypeOf<UiRowsPort>();
});

it('keeps the local edit patch identical to the editor provider fields', () => {
  expectTypeOf<MediaProviderEditPatch>().toEqualTypeOf<UiFields>();
});
