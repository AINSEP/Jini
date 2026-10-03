import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { findMenu, relayFindResults } from '../electron/usability/index.js';
import { createSpeechBridge, speechChannels } from '../speech/index.js';
import { ensureHelperCompiled } from '../speech/macos/index.js';

it('publishes all subpaths with explicit runtime metadata and copies the native asset', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  const entries: Record<string, [string, string]> = {
    '.': ['index', 'desktop'],
    './bridge-testing': ['bridge-testing', 'universal'],
    './electron': ['electron/index', 'desktop'],
    './tauri': ['tauri/index', 'desktop'],
    './shutdown': ['shutdown/index', 'node'],
    './electron/navigation-policy': ['electron/navigation-policy/index', 'desktop'],
    './electron/updates': ['electron/updates/index', 'desktop'],
    './node-toolchain': ['node-toolchain/index', 'node'],
    './electron/usability': ['electron/usability/index', 'desktop'],
    './speech': ['speech/index', 'desktop'],
    './speech/macos': ['speech/macos/index', 'node'],
  };
  for (const [subpath, [entry, runtime]] of Object.entries(entries)) {
    expect(manifest.exports[subpath]).toEqual({ types: `./dist/${entry}.d.ts`, import: `./dist/${entry}.js`, default: `./dist/${entry}.js` });
    expect(manifest.jini.entries[subpath]).toBe(runtime);
  }
  expect(manifest.exports['./speech/macos/speech-helper.swift']).toBe('./dist/speech/macos/speech-helper.swift');
  expect(manifest.jini.entries['./speech/macos/speech-helper.swift']).toBe('node');
  expect(manifest.scripts.build).toContain('cp src/speech/macos/speech-helper.swift dist/speech/macos/speech-helper.swift');
  expect(fileURLToPath(new URL('../speech/macos/speech-helper.swift', import.meta.url))).toMatch(/speech-helper\.swift$/);
});

it('uses object arguments for menu commands and detaches the exact result listener', () => {
  const sent: unknown[] = [];
  const menu = findMenu({ channel: 'host:find', labels: { menu: 'Search', item: 'Find' } });
  menu.submenu[0].click({ window: { isDestroyed: () => false, webContents: { send: args => { sent.push(args); } } } });
  expect(sent).toEqual([{ channel: 'host:find' }]);
  let attached: unknown;
  let detached: unknown;
  const dispose = relayFindResults({ resultChannel: 'host:result', window: { isDestroyed: () => false, webContents: {
    on: ({ listener }) => { attached = listener; },
    removeListener: ({ listener }) => { detached = listener; },
    send: () => {},
  } } });
  dispose();
  expect(detached).toBe(attached);
});

it('maps object-argument speech invocation to the unchanged native payload', async () => {
  const wire: unknown[][] = [];
  const bridge = createSpeechBridge({ channelNamespace: 'host:voice', ipcRenderer: {
    invoke: async ({ channel }, { args = [] } = {}) => { wire.push([channel, ...args]); return { text: 'hello', elapsedMs: 1 }; },
  } });
  await bridge.isAvailable();
  expect(await bridge.transcribe({ samples: [0], sampleRate: 16000 })).toEqual({ text: 'hello', elapsedMs: 1 });
  expect(wire).toEqual([['host:voice:isAvailable'], ['host:voice:transcribe', [0], 16000]]);
  expect(speechChannels({ channelNamespace: 'other:voice' }).transcribe).toBe('other:voice:transcribe');
});

it('compiles the native helper through object-argument filesystem and process ports', () => {
  const calls: unknown[] = [];
  expect(ensureHelperCompiled({
    fs: { existsSync: ({ path }) => { calls.push({ path }); return false; }, mkdirSync: (args, options) => { calls.push([args, options]); } },
    spawnSync: args => { calls.push(args); return { status: 0 }; },
    sourcePath: '/host/helper.swift', binaryPath: '/host/bin/helper', compilerPath: '/usr/bin/swiftc',
    messages: { compilerMissing: 'missing', compilerFailed: ({ stderr }) => stderr, invalidOutput: ({ stdout }) => stdout, cannotTranscribe: ({ reason }) => reason, recognitionFailed: ({ reason }) => reason },
  })).toEqual({ ok: true });
  expect(calls).toEqual([{ path: '/host/bin/helper' }, [{ path: '/host/bin' }, { recursive: true }], { command: '/usr/bin/swiftc', args: ['-O', '/host/helper.swift', '-o', '/host/bin/helper'] }]);
});
