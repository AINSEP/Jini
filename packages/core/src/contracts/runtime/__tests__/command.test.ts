import { describe, expect, it } from 'vitest';
import { planCommandInvocation } from '../command.js';

describe('planCommandInvocation', () => {
  it('passes a non-shim command through on linux', () => {
    expect(planCommandInvocation({ command: 'a.cmd', platform: 'linux', env: {} }, { args: ['x'] })).toEqual({ command: 'a.cmd', args: ['x'] });
  });
  it('wraps a win32 .cmd with spaces in a verbatim cmd.exe shim', () => {
    const r = planCommandInvocation({ command: 'C:\\Program Files\\t.cmd', platform: 'win32', env: { ComSpec: 'C:\\w\\cmd.exe' } }, { args: ['a b'] });
    expect(r).toEqual({ command: 'C:\\w\\cmd.exe', args: ['/d', '/s', '/c', '"\"C:\\Program Files\\t.cmd\" \"a b\""'], windowsVerbatimArguments: true });
  });
  it('breaks percent pairs so cmd.exe cannot expand them', () => {
    const r = planCommandInvocation({ command: 'x.bat', platform: 'win32', env: {} }, { args: ['%A%'] });
    expect(r.args[3]).toBe('"x.bat ""^%"A"^%"""');
  });
  it('doubles trailing backslashes of a quoted argument', () => {
    const r = planCommandInvocation({ command: 'x.bat', platform: 'win32', env: {} }, { args: ['a b\\'] });
    expect(r.args[3]).toBe('"x.bat "a b\\\\""');
  });
  it('refuses line breaks in a shim argument', () => {
    expect(() => planCommandInvocation({ command: 'x.cmd', platform: 'win32', env: {} }, { args: ['a\nb'] })).toThrow(/line breaks/);
  });
  it('resolves ComSpec from env, then the fallback, then cmd.exe', () => {
    const pick = (env: Record<string, string>, fallbackComSpec?: string) =>
      planCommandInvocation({ command: 'x.cmd', platform: 'win32', env }, fallbackComSpec === undefined ? {} : { fallbackComSpec }).command;
    expect(pick({ ComSpec: 'E' }, 'F')).toBe('E');
    expect(pick({}, 'F')).toBe('F');
    expect(pick({})).toBe('cmd.exe');
  });
});
