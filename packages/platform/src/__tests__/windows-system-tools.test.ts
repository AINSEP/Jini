import { describe, expect, it } from 'vitest';
import { windowsPowerShell, windowsSystemTool } from '../windows-system-tools.js';

describe('@jini-ai/platform — windows system tools', () => {
  it('resolves a tool under the environment system root', () => {
    expect(windowsSystemTool({ relativePath: ['reg.exe'], env: { SystemRoot: 'D:\\WinNT' } })).toBe('D:\\WinNT\\System32\\reg.exe');
  });

  it('falls back to windir, then C:\\Windows', () => {
    expect(windowsSystemTool({ relativePath: ['reg.exe'], env: { windir: 'E:\\Win' } })).toBe('E:\\Win\\System32\\reg.exe');
    expect(windowsSystemTool({ relativePath: ['reg.exe'], env: {} })).toBe('C:\\Windows\\System32\\reg.exe');
  });

  it('names Windows PowerShell 5.1 by absolute path', () => {
    expect(windowsPowerShell({ env: {} })).toMatch(/\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe$/);
  });
});

it('uses each host root and resolves Windows key casing with SystemRoot precedence', () => {
  expect(windowsPowerShell({ env: { SYSTEMROOT: 'D:\\HostOne', WINDIR: 'F:\\Ignored' })).toBe('D:\\HostOne\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  expect(windowsPowerShell({ env: { systemroot: 'E:\\HostTwo' })).toBe('E:\\HostTwo\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
});
