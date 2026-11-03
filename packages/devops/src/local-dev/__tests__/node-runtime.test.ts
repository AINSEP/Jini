import { expect, test } from 'vitest';
import { selectNodeRuntime } from '../node-runtime.js';

test('dev API uses the installed desktop runtime as Node, including Windows executable paths', () => {
  const command = 'C:\\repo with spaces\\electron.exe';
  expect(selectNodeRuntime({ searchFrom: ['/repo'], nodePath: '/node' }, {
    resolveBinary: () => command, usable: () => true,
  })).toEqual({ command, env: { ELECTRON_RUN_AS_NODE: '1' }, fallback: false });
});

test('a missing or unusable desktop runtime falls back to the supplied stock Node', () => {
  for (const resolveBinary of [() => { throw new Error('missing'); }, () => '/broken']) {
    expect(selectNodeRuntime({ searchFrom: ['/repo'], nodePath: '/node' }, {
      resolveBinary, usable: () => false,
    })).toEqual({ command: '/node', env: {}, fallback: true });
  }
});

test('runtime discovery tries the desktop workspace after the root installation', () => {
  const seen: string[] = [];
  const result = selectNodeRuntime({ searchFrom: ['/root', '/desktop'], nodePath: '/node' }, {
    resolveBinary: ({ directory }) => { seen.push(directory); return directory; },
    usable: ({ command }) => command === '/desktop',
  });
  expect(seen).toEqual(['/root', '/desktop']);
  expect(result.command).toBe('/desktop');
});
