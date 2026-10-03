import { describe, expect, it } from 'vitest';
import { createMockJiniHost, installMockJiniHost } from '../bridge-testing.js';
import { getJiniHost, isJiniHostBridge, openHostExternalUrl } from '../bridge.js';
import { createFileLogger } from '../logging.js';
import { resolveDesktopHostPathRoots } from '../paths.js';
import { createElectronWindowLifecyclePort } from '../electron/electron-window-lifecycle.js';
import { createFakeBrowserWindowFactory } from '../electron/testing.js';
import { RenderServiceError } from '../render-service.js';

describe('required args and optional args', () => {
  it('validates and narrows the required value object', () => {
    const args: { value: unknown } = { value: createMockJiniHost({}) };
    expect(isJiniHostBridge(args)).toBe(true);
    if (!isJiniHostBridge(args)) throw new Error('expected a valid bridge');
    expect(args.value.client.type).toBe('electron');
  });

  it('keeps scoped bridge installation isolated and restores the previous host', async () => {
    const first = createMockJiniHost({}, { client: { type: 'tauri' } });
    const scope = { __jini__: first };
    const seen: string[] = [];
    const uninstall = installMockJiniHost({}, {
      scope,
      host: { shell: { openExternal: async ({ url }) => { seen.push(url); return { ok: true }; } } },
    });
    try {
      expect(await openHostExternalUrl({ url: 'https://example.test/path' }, { scope })).toEqual({ ok: true });
      expect(seen).toEqual(['https://example.test/path']);
    } finally { uninstall(); }
    expect(getJiniHost({}, { scope })).toBe(first);
  });

  it('keeps window URLs required and size/show optional through the injected factory', async () => {
    const { factory, windows } = createFakeBrowserWindowFactory({});
    const seen: unknown[] = [];
    const lifecycle = createElectronWindowLifecyclePort({
      createBrowserWindow: (requiredArgs, optionalArgs) => {
        seen.push([requiredArgs, optionalArgs]);
        return factory(requiredArgs, optionalArgs);
      },
    });
    const handle = await lifecycle.createWindow({ url: 'https://example.test/' }, { width: 720, show: false });
    expect(seen).toEqual([[{}, { show: false, width: 720 }]]);
    expect(windows).toHaveLength(1);
    expect(lifecycle.getMainWindow()).toBe(handle);
    handle.close();
    expect(lifecycle.getMainWindow()).toBeNull();
  });

  it('passes log output to an injected port with object arguments', () => {
    const lines: string[] = [];
    const logger = createFileLogger({ logPath: '/caller/state.log' }, {
      echoToConsole: false,
      append: ({ path, data, encoding }) => {
        expect(path).toBe('/caller/state.log');
        expect(encoding).toBe('utf8');
        lines.push(data);
      },
    });
    logger.info({ message: 'ready' }, { meta: { pid: 42 } });
    expect(JSON.parse(lines[0]!)).toMatchObject({ level: 'info', message: 'ready', meta: { pid: 42 } });
  });

  it('keeps caller-selected path overrides separate from required layout', () => {
    const roots = resolveDesktopHostPathRoots({ namespace: 'preview', namespaceBaseRoot: '/caller' }, {
      dataDirOverrideEnvVar: 'SAMPLE_DATA', env: { SAMPLE_DATA: '/other' },
    });
    expect(roots.namespaceRoot).toBe('/caller/preview');
    expect(roots.dataRoot).toBe('/other/namespaces/preview/data');
  });

  it('preserves error names, messages and codes with required constructor args', () => {
    const error = new RenderServiceError({ message: 'stopped', code: 'aborted' });
    expect({ name: error.name, message: error.message, code: error.code }).toEqual({ name: 'RenderServiceError', message: 'stopped', code: 'aborted' });
  });
});
