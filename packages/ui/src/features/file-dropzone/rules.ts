/**
 * Pure logic for the file-dropzone feature. No React, no DOM globals — every
 * DOM-shaped value (`File`, event targets) arrives as a parameter.
 */
import { FILE_DROPZONE_KIND_BY_EXTENSION } from './constants.js';
import type { FileDropzoneKind } from './types.js';
import { trimChars } from '../../utils/trim-chars.js';

/** Lowercased extension (no dot), or `''` for an extensionless name. */
export function fileDropzoneExtension(file: File): string {
  return (/\.([a-z0-9]+)$/i.exec(file.name)?.[1] ?? '').toLowerCase();
}

/** MIME-first (authoritative when present), falling back to extension for files the browser typed as `application/octet-stream`. */
export function fileDropzoneKind(file: File): FileDropzoneKind {
  const type = file.type.toLowerCase();
  const ext = fileDropzoneExtension(file);
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  if (type === 'application/pdf') return 'pdf';
  if (type === 'text/html') return 'html';
  if (type.startsWith('font/')) return 'font';
  if (type.startsWith('text/')) return 'text';
  return FILE_DROPZONE_KIND_BY_EXTENSION[ext] ?? 'other';
}

/** Kinds renderable straight from an object URL (`blob:`). Fonts also need one (`FontFace` loads from a URL); text is read via `FileReader`/`Blob.text()` instead. */
export function fileDropzoneNeedsObjectUrl(kind: FileDropzoneKind): boolean {
  return kind === 'image' || kind === 'video' || kind === 'audio' || kind === 'pdf' || kind === 'html' || kind === 'font';
}

/** Uppercased, 4-char-capped extension for the glyph badge (e.g. `"a/b.jpeg"` -> `"JPEG"`, extensionless -> `"FILE"`). */
export function fileDropzoneExtensionLabel(file: File): string {
  return (fileDropzoneExtension(file) || 'file').toUpperCase().slice(0, 4);
}

export function fileDropzoneSizeLabel(bytes: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** A stable key for a staged `File` (name + size + mtime is collision-safe for the staging lists this feature renders). */
export function fileDropzoneStagingKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

/** CSS-safe, collision-resistant `@font-face` family name for a staged font at `index`. */
export function fileDropzoneFontFamilyName(file: File, index: number): string {
  const slug = trimChars(file.name.replace(/[^a-z0-9]+/gi, '-'), '-').slice(0, 24);
  return `jini-file-dropzone-font-${index}-${slug || 'font'}`;
}

/** Whether a selection is large enough (by count or total bytes) to warrant a loading affordance while it's staged. */
export function fileDropzoneShouldShowProcessing(
  files: readonly File[],
  fileCountThreshold: number,
  totalBytesThreshold: number,
): boolean {
  if (files.length >= fileCountThreshold) return true;
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  return totalBytes >= totalBytesThreshold;
}
