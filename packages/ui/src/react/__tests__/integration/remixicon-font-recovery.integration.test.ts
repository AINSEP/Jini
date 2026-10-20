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

  describe('stylesheets it leaves alone', () => {
    function attach(css: string): HTMLStyleElement {
      const style = document.createElement('style');
      style.setAttribute('data-jini-remixicon', '');
      style.textContent = css;
      document.head.appendChild(style);
      return style;
    }
    function start(stylesheet: HTMLStyleElement | HTMLLinkElement) {
      const loads: string[] = [];
      const dispose = startRemixIconStylesheetRecovery({
        stylesheet, baseUrl: 'https://admin.example/admin/',
        fonts: { load: async (font) => { loads.push(font); return []; }, check: () => false, add: () => {} },
        timers: { setTimeout: () => 1, clearTimeout: () => {} },
        createFontFace: () => { throw new Error('createFontFace must not run for an ignored stylesheet'); },
      });
      return { dispose, loads };
    }

    it('ignores a sheet whose rules cannot be read (cross-origin)', async () => {
      const link = document.createElement('link');
      Object.defineProperty(link, 'sheet', { value: { get cssRules(): CSSRuleList { throw new DOMException('cross-origin', 'SecurityError'); } } });
      const { dispose, loads } = start(link);
      await Promise.resolve();
      expect(loads).toEqual([]);
      expect(dispose()).toBeUndefined();
    });

    it('ignores a link that has not loaded a sheet', async () => {
      const { loads } = start(document.createElement('link'));
      await Promise.resolve();
      expect(loads).toEqual([]);
    });

    it('ignores a sheet without a remixicon face', async () => {
      const { loads } = start(attach('.x { color: red; } @font-face { font-family: "Other"; src: url("/o.woff2"); }'));
      await Promise.resolve();
      expect(loads).toEqual([]);
    });

    it('ignores a remixicon face with no url() source, even when a later one has one', async () => {
      const { loads } = start(attach('@font-face { font-family: remixicon; src: local("remixicon"); } @font-face { font-family: remixicon; src: url("/r.woff2"); }'));
      await Promise.resolve();
      expect(loads).toEqual([]);
    });
  });

  it('keeps a non-http source URL as-is, without a retry query parameter', async () => {
    const style = document.createElement('style');
    style.setAttribute('data-jini-remixicon', '');
    style.textContent = '@font-face { font-family: remixicon; src: url("blob:https://admin.example/abc") format("woff2"); }';
    document.head.appendChild(style);
    let retry!: () => void;
    let source = '';
    startRemixIconStylesheetRecovery({
      stylesheet: style, baseUrl: 'https://admin.example/admin/',
      fonts: { load: async () => { throw new Error('restart'); }, check: () => false, add: () => {} },
      timers: { setTimeout(run) { retry = run; return 1; }, clearTimeout() {} },
      createFontFace(input) { source = input.source; return { load: async () => ({ family: 'remixicon' }) as FontFace } as FontFace; },
    });
    await Promise.resolve(); await Promise.resolve();
    retry();
    expect(source).toBe('url("blob:https://admin.example/abc") format("woff2")');
  });
});

