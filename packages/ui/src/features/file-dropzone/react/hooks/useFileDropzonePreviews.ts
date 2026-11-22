import { useEffect, useState } from 'react';
import { fileDropzoneFontFamilyName, fileDropzoneKind, fileDropzoneNeedsObjectUrl } from '../../rules.js';
import { FILE_DROPZONE_TEXT_PREVIEW_BYTES } from '../../constants.js';
import type { FileDropzonePreviewState } from '../../types.js';

/** Object URL for a file preview, or `null` where unavailable (e.g. no `URL.createObjectURL` in the current environment). */
function createPreviewUrl(file: File): string | null {
  try {
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return null;
    return URL.createObjectURL(file);
  } catch {
    return null;
  }
}

function revokePreviewUrl(url: string): void {
  try {
    URL.revokeObjectURL?.(url);
  } catch {
    /* no-op */
  }
}

/**
 * Derives preview state for every staged `file` that can render one:
 * object URLs (image/video/audio/pdf/html/font), loaded `FontFace` family
 * names, and bounded text snippets. Ported from
 * `DesignSystemAssetDropzone.tsx`'s three `files`-keyed effects.
 */
export function useFileDropzonePreviews(files: readonly File[]): FileDropzonePreviewState {
  // Creation and revocation MUST be paired inside one `files`-keyed effect:
  // the cleanup revokes exactly the URLs its own setup created. This is the
  // StrictMode-safe shape — the origin's own doc comment on this effect
  // explains the alternative (create in a `useMemo`, revoke in a separate
  // empty-deps cleanup) breaks any preview staged at first mount, because
  // StrictMode's simulated unmount fires the cleanup and revokes the URLs,
  // then the remount hands back those now-dead `blob:` links.
  const [previewUrls, setPreviewUrls] = useState<Map<File, string>>(new Map());
  useEffect(() => {
    const next = new Map<File, string>();
    for (const file of files) {
      if (!fileDropzoneNeedsObjectUrl({ kind: fileDropzoneKind(file) })) continue;
      const url = createPreviewUrl(file);
      if (url) next.set(file, url);
    }
    setPreviewUrls(next);
    return () => {
      for (const url of next.values()) revokePreviewUrl(url);
    };
  }, [files]);

  // Loads each staged font via the FontFace API so its thumbnail + lightbox
  // can render a real specimen. Registered faces are removed on cleanup so
  // re-staging never leaks families into `document.fonts`.
  const [fontFamilies, setFontFamilies] = useState<Map<File, string>>(new Map());
  useEffect(() => {
    if (typeof FontFace === 'undefined' || typeof document === 'undefined' || !document.fonts) {
      return undefined;
    }
    let cancelled = false;
    const ready = new Map<File, string>();
    const registered: FontFace[] = [];
    files.forEach((file, index) => {
      if (fileDropzoneKind(file) !== 'font') return;
      const url = previewUrls.get(file);
      if (!url) return;
      const family = fileDropzoneFontFamilyName({ file, index });
      try {
        const face = new FontFace(family, `url(${url})`);
        registered.push(face);
        void face
          .load()
          .then((loaded) => {
            if (cancelled) return;
            document.fonts.add(loaded);
            ready.set(file, family);
            setFontFamilies(new Map(ready));
          })
          .catch(() => {
            /* unreadable / unsupported font — falls back to the glyph */
          });
      } catch {
        /* FontFace construction failed — glyph fallback */
      }
    });
    return () => {
      cancelled = true;
      for (const face of registered) {
        try {
          document.fonts.delete(face);
        } catch {
          /* no-op */
        }
      }
    };
  }, [files, previewUrls]);

  // Reads a bounded slice of each text-like file for a snippet thumbnail +
  // scrollable lightbox preview. Capped so a large JSON/CSS never blocks.
  const [textSnippets, setTextSnippets] = useState<Map<File, string>>(new Map());
  useEffect(() => {
    const pending = files.filter((file) => fileDropzoneKind(file) === 'text');
    if (pending.length === 0) {
      setTextSnippets(new Map());
      return undefined;
    }
    let cancelled = false;
    const next = new Map<File, string>();
    void Promise.all(
      pending.map(async (file) => {
        try {
          const slice = typeof file.slice === 'function' ? file.slice(0, FILE_DROPZONE_TEXT_PREVIEW_BYTES) : file;
          const text = await slice.text();
          next.set(file, text);
        } catch {
          /* unreadable — lightbox shows the name/size fallback */
        }
      }),
    ).then(() => {
      if (!cancelled) setTextSnippets(next);
    });
    return () => {
      cancelled = true;
    };
  }, [files]);

  return { previewUrls, fontFamilies, textSnippets };
}
