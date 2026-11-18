import { describe, expect, it } from 'vitest';
import {
  fileDropzoneExtension,
  fileDropzoneExtensionLabel,
  fileDropzoneFontFamilyName,
  fileDropzoneKind,
  fileDropzoneNeedsObjectUrl,
  fileDropzoneShouldShowProcessing,
  fileDropzoneSizeLabel,
  fileDropzoneStagingKey,
} from './rules.js';

function file(name: string, type = '', size = 0): File {
  return new File([new Uint8Array(size)], name, { type });
}

describe('fileDropzoneExtension', () => {
  it('lowercases a mixed-case extension', () => {
    expect(fileDropzoneExtension(file('Photo.PNG'))).toBe('png');
  });

  it('returns empty string for an extensionless name', () => {
    expect(fileDropzoneExtension(file('README'))).toBe('');
  });
});

describe('fileDropzoneKind', () => {
  it('trusts an image/* MIME type over extension', () => {
    expect(fileDropzoneKind(file('weird.bin', 'image/png'))).toBe('image');
  });

  it('trusts video/* and audio/* MIME types', () => {
    expect(fileDropzoneKind(file('a', 'video/mp4'))).toBe('video');
    expect(fileDropzoneKind(file('a', 'audio/mpeg'))).toBe('audio');
  });

  it('recognizes application/pdf and text/html MIME types', () => {
    expect(fileDropzoneKind(file('a', 'application/pdf'))).toBe('pdf');
    expect(fileDropzoneKind(file('a', 'text/html'))).toBe('html');
  });

  it('recognizes a generic font/* MIME type', () => {
    expect(fileDropzoneKind(file('a', 'font/woff2'))).toBe('font');
  });

  it('recognizes a generic text/* MIME type', () => {
    expect(fileDropzoneKind(file('a', 'text/csv'))).toBe('text');
  });

  it('falls back to extension when MIME type is empty (e.g. application/octet-stream)', () => {
    expect(fileDropzoneKind(file('brand.woff2', ''))).toBe('font');
    expect(fileDropzoneKind(file('deck.pptx', ''))).toBe('slides');
  });

  it('falls back to "other" for an unrecognized extension and MIME', () => {
    expect(fileDropzoneKind(file('archive.zip', ''))).toBe('other');
  });
});

describe('fileDropzoneNeedsObjectUrl', () => {
  it('is true for image/video/audio/pdf/html/font', () => {
    for (const kind of ['image', 'video', 'audio', 'pdf', 'html', 'font'] as const) {
      expect(fileDropzoneNeedsObjectUrl({ kind })).toBe(true);
    }
  });

  it('is false for slides/text/other', () => {
    for (const kind of ['slides', 'text', 'other'] as const) {
      expect(fileDropzoneNeedsObjectUrl({ kind })).toBe(false);
    }
  });
});

describe('fileDropzoneExtensionLabel', () => {
  it('uppercases and caps at 4 chars', () => {
    expect(fileDropzoneExtensionLabel(file('a.jpeg'))).toBe('JPEG');
  });

  it('falls back to FILE for an extensionless name', () => {
    expect(fileDropzoneExtensionLabel(file('README'))).toBe('FILE');
  });
});

describe('fileDropzoneSizeLabel', () => {
  it('returns empty string for zero or negative bytes', () => {
    expect(fileDropzoneSizeLabel({ bytes: 0 })).toBe('');
    expect(fileDropzoneSizeLabel({ bytes: -5 })).toBe('');
  });

  it('formats sub-KB sizes in bytes', () => {
    expect(fileDropzoneSizeLabel({ bytes: 512 })).toBe('512 B');
  });

  it('formats sub-MB sizes in rounded KB', () => {
    expect(fileDropzoneSizeLabel({ bytes: 2048 })).toBe('2 KB');
  });

  it('formats MB-and-above sizes with one decimal', () => {
    expect(fileDropzoneSizeLabel({ bytes: 5 * 1024 * 1024 })).toBe('5.0 MB');
  });
});

describe('fileDropzoneStagingKey', () => {
  it('combines name, size, and lastModified', () => {
    const f = new File(['x'], 'a.txt', { lastModified: 123 });
    expect(fileDropzoneStagingKey(f)).toBe(`a.txt:${f.size}:123`);
  });
});

describe('fileDropzoneFontFamilyName', () => {
  it('slugifies the filename (collapsing runs of non-alphanumerics to one dash) and includes the index', () => {
    expect(fileDropzoneFontFamilyName({ file: file('My Font!.woff2'), index: 2 })).toBe('jini-file-dropzone-font-2-My-Font-woff2');
  });

  it('falls back to "font" for a name that slugifies to nothing', () => {
    expect(fileDropzoneFontFamilyName({ file: file('!!!'), index: 0 })).toBe('jini-file-dropzone-font-0-font');
  });

  it('caps the slug at 24 characters', () => {
    const long = file('abcdefghijklmnopqrstuvwxyz.woff2');
    const name = fileDropzoneFontFamilyName({ file: long, index: 0 });
    expect(name).toBe('jini-file-dropzone-font-0-abcdefghijklmnopqrstuvwx');
  });
});

describe('fileDropzoneShouldShowProcessing', () => {
  it('is true when the file count meets the threshold', () => {
    const files = Array.from({ length: 3 }, () => file('a', '', 10));
    expect(fileDropzoneShouldShowProcessing({ files, fileCountThreshold: 3, totalBytesThreshold: 1_000_000 })).toBe(true);
  });

  it('is false when below both thresholds', () => {
    const files = [file('a', '', 10), file('b', '', 10)];
    expect(fileDropzoneShouldShowProcessing({ files, fileCountThreshold: 3, totalBytesThreshold: 1_000_000 })).toBe(false);
  });

  it('is true when the total byte size meets the threshold even with few files', () => {
    const files = [file('a', '', 900), file('b', '', 200)];
    expect(fileDropzoneShouldShowProcessing({ files, fileCountThreshold: 10, totalBytesThreshold: 1000 })).toBe(true);
  });
});
