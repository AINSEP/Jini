// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { startRemixIconStylesheetRecovery } from '../../components/remixicon-font-recovery.js';

afterEach(() => { document.head.querySelectorAll('[data-jini-remixicon]').forEach((sheet) => sheet.remove()); });

describe('host inline RemixIcon font override', () => {
  it('recovers the Vite-resolved asset and registers its successful replacement without changing the style', async () => {
    const style = document.createElement('style');
    style.setAttribute('data-jini-remixicon', '');
    style.textContent = '@font-face { font-family: "remixicon"; src: url("/admin/assets/remixicon-abc.woff2?v=7") format("woff2"); font-display: swap; }';
    document.head.appendChild(style);
    const loaded = { family: 'remixicon', status: 'loaded' } as FontFace;
    const applied: FontFace[] = [];
    const faces: Array<{ family: string; source: string; descriptors: FontFaceDescriptors }> = [];
    let retry!: () => void;
    startRemixIconStylesheetRecovery({
      stylesheet: style, baseUrl: 'https://admin.example/admin/',
      fonts: {
        load: async () => { throw new Error('restart'); },
        check: () => false,
        add: (face) => { applied.push(face); },
      },
      timers: { setTimeout(run) { retry = run; return 1; }, clearTimeout() {} },
      createFontFace({ family, source, descriptors }) {
        faces.push({ family, source, descriptors });
        return { load: async () => loaded } as FontFace;
      },
    });
    await Promise.resolve(); await Promise.resolve();
    expect(applied).toEqual([]);
    retry();
    await Promise.resolve(); await Promise.resolve();
    expect(faces).toEqual([{
      family: 'remixicon',
      source: 'url("https://admin.example/admin/assets/remixicon-abc.woff2?v=7&jini-font-retry=1") format("woff2")',
      descriptors: { display: 'swap' },
    }]);
    expect(applied).toEqual([loaded]);
    expect(document.querySelector('[data-jini-remixicon]')).toBe(style);
    expect(style.textContent).toContain('/admin/assets/remixicon-abc.woff2?v=7');
  });

  it('resolves a linked stylesheet font against the CSS URL rather than the admin page', async () => {
    const style = document.createElement('style');
    style.setAttribute('data-jini-remixicon', '');
    style.textContent = '@font-face { font-family: remixicon; src: url("../fonts/icons.woff2") format("woff2"); }';
    document.head.appendChild(style);
    const link = document.createElement('link');
    const sheet = style.sheet!;
    Object.defineProperty(sheet, 'href', { value: 'https://assets.example/css/icons.css' });
    Object.defineProperty(link, 'sheet', { value: sheet });
    let retry!: () => void;
    let source = '';
    const loaded = { family: 'remixicon', status: 'loaded' } as FontFace;
    const applied: FontFace[] = [];
    startRemixIconStylesheetRecovery({
      stylesheet: link, baseUrl: 'https://admin.example/admin/',
      fonts: { load: async () => { throw new Error('restart'); }, check: () => false, add: (face) => { applied.push(face); } },
      timers: { setTimeout(run) { retry = run; return 1; }, clearTimeout() {} },
      createFontFace(input) { source = input.source; return { load: async () => loaded } as FontFace; },
    });
    await Promise.resolve(); await Promise.resolve();
    retry();
    await Promise.resolve(); await Promise.resolve();
    expect(source).toBe('url("https://assets.example/fonts/icons.woff2?jini-font-retry=1") format("woff2")');
    expect(applied).toEqual([loaded]);
  });
});
