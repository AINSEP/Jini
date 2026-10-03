import { describe, expect, it, vi } from 'vitest';
import { RenderServiceError } from '../../render-service.js';
import { createElectronRenderService } from '../electron-render-service.js';
import type { ElectronBrowserWindowFactory, ElectronBrowserWindowOptions } from '../electron-surfaces.js';
import { createFakeBrowserWindowFactory } from '../testing.js';

describe('createElectronRenderService', () => {
  it('renderToPdf loads the html and returns printToPDF bytes, then destroys the window', async () => {
    const pdfResult = Buffer.from('%PDF-1.4 fake');
    const { factory, windows } = createFakeBrowserWindowFactory({}, { pdfResult });
    const service = createElectronRenderService({ createBrowserWindow: factory });
    const bytes = await service.renderToPdf({ html: '<html></html>' });
    expect(Buffer.from(bytes).equals(pdfResult)).toBe(true);
    expect(windows[0]?.isDestroyed()).toBe(true);
  });

  it('capture loads the html and returns a PNG from capturePage', async () => {
    const pngResult = Buffer.from('fake-png');
    const { factory } = createFakeBrowserWindowFactory({}, { pngResult });
    const service = createElectronRenderService({ createBrowserWindow: factory });
    const bytes = await service.capture({ html: '<html></html>' });
    expect(Buffer.from(bytes).equals(pngResult)).toBe(true);
  });

  it('capture falls back to the fake\'s default PNG bytes when no pngResult script is given', async () => {
    const { factory } = createFakeBrowserWindowFactory({});
    const service = createElectronRenderService({ createBrowserWindow: factory });
    const bytes = await service.capture({ html: '<html></html>' });
    expect(Buffer.from(bytes).equals(Buffer.from('png-bytes'))).toBe(true);
  });

  it('rejects with a load-failed RenderServiceError when did-fail-load fires', async () => {
    const { factory, windows } = createFakeBrowserWindowFactory({}, { failLoad: { errorCode: -6, errorDescription: 'ERR_FILE_NOT_FOUND' } });
    const service = createElectronRenderService({ createBrowserWindow: factory });
    await expect(service.renderToPdf({ html: '<html></html>' })).rejects.toMatchObject({ code: 'load-failed' });
    expect(windows[0]?.isDestroyed()).toBe(true);
  });

  it('times out and destroys the window when the load hangs', async () => {
    const { factory, windows } = createFakeBrowserWindowFactory({}, { hang: true });
    const service = createElectronRenderService({ createBrowserWindow: factory });
    await expect(service.renderToPdf({ html: '<html></html>' }, { timeoutMs: 30 })).rejects.toMatchObject({ code: 'timeout' });
    expect(windows[0]?.isDestroyed()).toBe(true);
  });

  it('aborts via signal even mid-render', async () => {
    const { factory } = createFakeBrowserWindowFactory({}, { hang: true });
    const service = createElectronRenderService({ createBrowserWindow: factory });
    const controller = new AbortController();
    const pending = service.renderToPdf({ html: '<html></html>' }, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'aborted' });
  });

  it('blocks navigation away from the render document by default', async () => {
    const { factory, windows } = createFakeBrowserWindowFactory({});
    const service = createElectronRenderService({ createBrowserWindow: factory });
    await service.renderToPdf({ html: '<html></html>' });
    const win = windows[0] as unknown as { triggerWillNavigate(url: string): boolean };
    expect(win.triggerWillNavigate('https://evil.example')).toBe(true);
  });

  it('cancels requests to origins outside the allowlist', async () => {
    const { factory, windows } = createFakeBrowserWindowFactory({});
    const service = createElectronRenderService({ createBrowserWindow: factory });
    await service.renderToPdf({ html: '<html></html>' }, { resourcePolicy: { allowedOrigins: ['https://good.example'] } });
    const win = windows[0] as unknown as { triggerBeforeRequest(url: string): { cancel: boolean } };
    expect(win.triggerBeforeRequest('https://good.example/x.png')).toEqual({ cancel: false });
    expect(win.triggerBeforeRequest('https://evil.example/x.png')).toEqual({ cancel: true });
  });

  it('blocks remote requests by default while allowing the inline render document', async () => {
    const { factory, windows } = createFakeBrowserWindowFactory({});
    const service = createElectronRenderService({ createBrowserWindow: factory });
    await service.renderToPdf({ html: '<html></html>' });
    const win = windows[0] as unknown as { triggerBeforeRequest(url: string): { cancel: boolean } };
    expect(win.triggerBeforeRequest('https://remote.example/a.png')).toEqual({ cancel: true });
    expect(win.triggerBeforeRequest('http://127.0.0.1/a.png')).toEqual({ cancel: true });
    expect(win.triggerBeforeRequest('data:image/png;base64,AAAA')).toEqual({ cancel: false });
    expect(win.triggerBeforeRequest('about:blank')).toEqual({ cancel: false });
  });

  it('permits remote requests only with an explicit unrestricted-network opt-out', async () => {
    const { factory, windows } = createFakeBrowserWindowFactory({});
    const service = createElectronRenderService({ createBrowserWindow: factory });
    await service.capture({ html: '<html></html>' }, { resourcePolicy: { allowUnrestrictedNetwork: true } });
    const win = windows[0] as unknown as { triggerBeforeRequest(url: string): { cancel: boolean } };
    expect(win.triggerBeforeRequest('https://remote.example/a.png')).toEqual({ cancel: false });
  });

  it('keeps an explicit allowlist restrictive even when the opt-out is also set', async () => {
    const { factory, windows } = createFakeBrowserWindowFactory({});
    const service = createElectronRenderService({ createBrowserWindow: factory });
    await service.capture({ html: '<html></html>' }, {
      resourcePolicy: { allowUnrestrictedNetwork: true, allowedOrigins: [] },
    });
    const win = windows[0] as unknown as { triggerBeforeRequest(url: string): { cancel: boolean } };
    expect(win.triggerBeforeRequest('https://remote.example/a.png')).toEqual({ cancel: true });
  });

  it('exportArtifact is not implemented by the Electron adapter', async () => {
    const { factory } = createFakeBrowserWindowFactory({});
    const service = createElectronRenderService({ createBrowserWindow: factory });
    await expect(service.exportArtifact({ html: '<html></html>', format: 'zip' })).rejects.toBeInstanceOf(RenderServiceError);
  });

  it('honors an explicit viewport, pageSize, and margins in renderToPdf', async () => {
    const pdfResult = Buffer.from('%PDF explicit');
    const { factory: rawBaseFactory } = createFakeBrowserWindowFactory({}, { pdfResult });
    const baseFactory = vi.fn(rawBaseFactory);
    let capturedWindowOptions: ElectronBrowserWindowOptions | undefined;
    let capturedPrintOptions: Record<string, unknown> | undefined;
    const factory: ElectronBrowserWindowFactory = (requiredArgs, options = {}) => {
      capturedWindowOptions = options;
      const win = baseFactory(requiredArgs, options);
      const originalPrintToPDF = win.webContents.printToPDF.bind(win.webContents);
      win.webContents.printToPDF = async (printOptions) => {
        capturedPrintOptions = printOptions;
        return originalPrintToPDF(printOptions);
      };
      return win;
    };
    const service = createElectronRenderService({ createBrowserWindow: factory });
    const bytes = await service.renderToPdf({ html: '<html></html>' }, {
      viewport: { width: 640, height: 480 },
      landscape: true,
      printBackground: false,
      pageWidth: 8.5,
      pageHeight: 11,
      margins: { top: 1, bottom: 1, left: 1, right: 1 },
    });
    expect(Buffer.from(bytes).equals(pdfResult)).toBe(true);
    expect(capturedWindowOptions?.width).toBe(640);
    expect(capturedWindowOptions?.height).toBe(480);
    expect(baseFactory).toHaveBeenCalledWith({}, {
      show: false, width: 640, height: 480, webPreferences: { javascript: true },
    });
    expect(capturedPrintOptions).toMatchObject({
      landscape: true,
      printBackground: false,
      pageSize: { width: 8.5, height: 11 },
      margins: { top: 1, bottom: 1, left: 1, right: 1 },
    });
  });
});
