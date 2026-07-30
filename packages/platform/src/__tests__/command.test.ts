import { describe, expect, it } from 'vitest';

import { createCommandInvocation, createPackageManagerInvocation } from '../command.js';

function withPlatform<T>(platform: NodeJS.Platform, run: () => T): T {
  const previous = process.platform;
  Object.defineProperty(process, 'platform', { value: platform });
  try {
    return run();
  } finally {
    Object.defineProperty(process, 'platform', { value: previous });
  }
}

describe('@jini-ai/platform — command — createCommandInvocation', () => {
  it('passes a .bat command straight through on non-Windows platforms', () => {
    withPlatform('darwin', () => {
      const invocation = createCommandInvocation({ args: ['--version'], command: 'tool.bat' });
      expect(invocation).toEqual({ args: ['--version'], command: 'tool.bat' });
      expect(invocation.windowsVerbatimArguments).toBeUndefined();
    });
  });

  it('passes a non-shim command straight through on Windows', () => {
    withPlatform('win32', () => {
      const invocation = createCommandInvocation({ args: ['--version'], command: 'node.exe' });
      expect(invocation).toEqual({ args: ['--version'], command: 'node.exe' });
    });
  });

  it('rewraps a .bat command on Windows into a cmd.exe shim, case-insensitively', () => {
    withPlatform('win32', () => {
      const invocation = createCommandInvocation({
        args: ['install'],
        command: 'C:\\tools\\pnpm.BAT',
        env: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
      });
      expect(invocation.command).toBe('C:\\Windows\\System32\\cmd.exe');
      expect(invocation.windowsVerbatimArguments).toBe(true);
      expect(invocation.args[0]).toBe('/d');
      expect(invocation.args[1]).toBe('/s');
      expect(invocation.args[2]).toBe('/c');
      expect(invocation.args[3]).toBe('"C:\\tools\\pnpm.BAT install"');
    });
  });

  it('rewraps a .cmd command on Windows the same way', () => {
    withPlatform('win32', () => {
      const invocation = createCommandInvocation({
        args: [],
        command: 'corepack.Cmd',
        env: { ComSpec: 'cmd.exe' },
      });
      expect(invocation.args[3]).toBe('"corepack.Cmd"');
    });
  });

  it('falls back to process.env.ComSpec when the request env has none', () => {
    withPlatform('win32', () => {
      const previousComSpec = process.env.ComSpec;
      process.env.ComSpec = 'C:\\real\\cmd.exe';
      try {
        const invocation = createCommandInvocation({ args: [], command: 'tool.cmd', env: {} });
        expect(invocation.command).toBe('C:\\real\\cmd.exe');
      } finally {
        if (previousComSpec === undefined) delete process.env.ComSpec;
        else process.env.ComSpec = previousComSpec;
      }
    });
  });

  it('falls back to the literal "cmd.exe" when no ComSpec is available anywhere', () => {
    withPlatform('win32', () => {
      const previousComSpec = process.env.ComSpec;
      delete process.env.ComSpec;
      try {
        const invocation = createCommandInvocation({ args: [], command: 'tool.cmd', env: {} });
        expect(invocation.command).toBe('cmd.exe');
      } finally {
        if (previousComSpec === undefined) delete process.env.ComSpec;
        else process.env.ComSpec = previousComSpec;
      }
    });
  });

  it('quotes arguments containing whitespace, doubles embedded quotes, and breaks out %VAR% percent-expansion', () => {
    withPlatform('win32', () => {
      const invocation = createCommandInvocation({
        args: ['plain', 'has space', 'has"quote', '50%off'],
        command: 'pkg.bat',
        env: { ComSpec: 'cmd.exe' },
      });
      const expectedInner = ['pkg.bat', 'plain', '"has space"', '"has""quote"', '"50"^%"off"'].join(' ');
      expect(invocation.args[3]).toBe(`"${expectedInner}"`);
    });
  });

  it('leaves an argument with no special characters unquoted', () => {
    withPlatform('win32', () => {
      const invocation = createCommandInvocation({ args: ['plainvalue'], command: 'x.bat', env: { ComSpec: 'cmd.exe' } });
      expect(invocation.args[3]).toBe('"x.bat plainvalue"');
    });
  });

  it('defaults args to an empty array when omitted', () => {
    withPlatform('darwin', () => {
      const invocation = createCommandInvocation({ command: 'node' });
      expect(invocation).toEqual({ args: [], command: 'node' });
    });
  });
});

describe('@jini-ai/platform — command — createPackageManagerInvocation', () => {
  it('routes a Node-loadable npm_execpath through process.execPath, case-insensitively', () => {
    const invocation = createPackageManagerInvocation(['install'], { npm_execpath: '/usr/lib/pnpm/bin/pnpm.CJS' });
    expect(invocation).toEqual({ args: ['/usr/lib/pnpm/bin/pnpm.CJS', 'install'], command: process.execPath });
  });

  it('routes an .mjs npm_execpath through process.execPath', () => {
    const invocation = createPackageManagerInvocation([], { npm_execpath: '/usr/lib/pnpm/bin/pnpm.mjs' });
    expect(invocation.command).toBe(process.execPath);
    expect(invocation.args).toEqual(['/usr/lib/pnpm/bin/pnpm.mjs']);
  });

  it('passes a non-Node-loadable npm_execpath straight through via createCommandInvocation', () => {
    withPlatform('darwin', () => {
      const invocation = createPackageManagerInvocation(['run', 'build'], { npm_execpath: '/usr/local/bin/pnpm' });
      expect(invocation).toEqual({ args: ['run', 'build'], command: '/usr/local/bin/pnpm' });
    });
  });

  it('rewraps a non-Node-loadable npm_execpath as a cmd.exe shim on Windows', () => {
    withPlatform('win32', () => {
      const invocation = createPackageManagerInvocation(['install'], {
        npm_execpath: 'C:\\pnpm\\pnpm.cmd',
        ComSpec: 'cmd.exe',
      });
      expect(invocation.windowsVerbatimArguments).toBe(true);
      expect(invocation.args[3]).toBe('"C:\\pnpm\\pnpm.cmd install"');
    });
  });

  it('passes a non-Node-loadable, non-shim npm_execpath straight through on Windows', () => {
    withPlatform('win32', () => {
      const invocation = createPackageManagerInvocation(['install'], { npm_execpath: 'C:\\pnpm\\pnpm.exe' });
      expect(invocation).toEqual({ args: ['install'], command: 'C:\\pnpm\\pnpm.exe' });
    });
  });

  it('falls back to "corepack pnpm …" on POSIX when npm_execpath is unset', () => {
    withPlatform('darwin', () => {
      const invocation = createPackageManagerInvocation(['install', '--frozen-lockfile'], {});
      expect(invocation).toEqual({ args: ['pnpm', 'install', '--frozen-lockfile'], command: 'corepack' });
    });
  });

  it('falls back to a corepack cmd.exe shim on Windows when npm_execpath is unset', () => {
    withPlatform('win32', () => {
      const invocation = createPackageManagerInvocation(['install'], { ComSpec: 'cmd.exe' });
      expect(invocation.command).toBe('cmd.exe');
      expect(invocation.windowsVerbatimArguments).toBe(true);
      expect(invocation.args[3]).toBe('"corepack pnpm install"');
    });
  });

  it('defaults env to process.env when omitted', () => {
    const previousExecPath = process.env.npm_execpath;
    delete process.env.npm_execpath;
    try {
      withPlatform('darwin', () => {
        const invocation = createPackageManagerInvocation(['install']);
        expect(invocation).toEqual({ args: ['pnpm', 'install'], command: 'corepack' });
      });
    } finally {
      if (previousExecPath === undefined) delete process.env.npm_execpath;
      else process.env.npm_execpath = previousExecPath;
    }
  });
});
