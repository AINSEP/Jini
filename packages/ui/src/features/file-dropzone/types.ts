/**
 * Pure types for the file-dropzone feature. No React.
 *
 * Consolidates two independent OD file-staging zones into one
 * primitive (see `packages/ui/archived provenance ledger` for the full consolidation
 * writeup): `DesignSystemAssetDropzone.tsx` (a rich, kind-aware thumbnail
 * grid over staged `File[]`) and `DesignSystemFlow.tsx`'s `DropZone` (a
 * labeled, prompt-driven zone with a file-dialog cancel-vs-still-loading
 * detection heuristic). Both are "a native drag/drop + click-to-browse
 * surface that resolves to a flat `File[]`" — this type set covers the
 * union of what either shape needs.
 */

/** The preview families this feature can render meaningfully in-browser. Anything else falls back to a typed glyph + filename. */
export type FileDropzoneKind =
  | 'image'
  | 'font'
  | 'pdf'
  | 'html'
  | 'video'
  | 'audio'
  | 'slides'
  | 'text'
  | 'other';

/** Per-file preview state the thumbnail grid + lightbox render from — object URLs (image/video/audio/pdf/html/font), loaded font family names, and text snippets. */
export interface FileDropzonePreviewState {
  previewUrls: ReadonlyMap<File, string>;
  fontFamilies: ReadonlyMap<File, string>;
  textSnippets: ReadonlyMap<File, string>;
}
