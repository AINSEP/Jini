import { describe, expect, it } from 'vitest';

import {
  mergeProxyAwareEnv,
  parseMacosScutilProxyOutput,
  parseWindowsInternetSettingsProxyOutput,
  resolveSystemProxyEnv,
} from '../proxy-env.js';

describe('@injini/platform — proxy-env — mergeProxyAwareEnv', () => {
  it('passes an explicitly-set NODE_USE_ENV_PROXY value through the canonical setter', () => {
    // Targets `setCanonicalProxyEnvValue`'s NODE_USE_ENV_PROXY branch, which
    // only fires when a *source* already carries that key (as opposed to the
    // auto-added "1" at the end of mergeProxyAwareEnv).
    const merged = mergeProxyAwareEnv('darwin', { node_use_env_proxy: '0' });
    expect(merged.NODE_USE_ENV_PROXY).toBe('0');
  });

  it('does not overwrite an explicit NODE_USE_ENV_PROXY even when a proxy endpoint is also present', () => {
    const merged = mergeProxyAwareEnv('darwin', { HTTP_PROXY: 'http://proxy.example:8080', NODE_USE_ENV_PROXY: '0' });
    expect(merged.NODE_USE_ENV_PROXY).toBe('0');
  });

  it('deletes a prior case-variant when a later source re-sets the same canonical key', () => {
    // First source sets the lowercase spelling; a later source's uppercase
    // re-spelling of the *same* proxy variable must delete both the
    // canonical and lowercase-alias entries the first source left behind
    // before writing its own value (`deleteProxyEnvVariants`'s match branch).
    const merged = mergeProxyAwareEnv('darwin', { http_proxy: 'http://a' }, { HTTP_PROXY: 'http://b' });
    expect(merged.HTTP_PROXY).toBe('http://b');
    expect(merged.http_proxy).toBe('http://b');
  });

  it('skips a source entry whose value is null/undefined', () => {
    const merged = mergeProxyAwareEnv('darwin', { FOO: undefined, PATH: '/usr/bin' } as Record<string, string | undefined>);
    expect(merged).toEqual({ PATH: '/usr/bin' });
  });

  it('within one source, prefers a lowercase spelling and only lets a non-lowercase re-spelling win over another non-lowercase one', () => {
    // Order: non-lowercase → non-lowercase (should overwrite: neither is the
    // preferred lowercase form) → lowercase (should overwrite: lowercase
    // always wins).
    const merged = mergeProxyAwareEnv('darwin', { Http_Proxy: 'mixed1', HTTP_PROXY: 'upper', http_proxy: 'lower' });
    expect(merged.HTTP_PROXY).toBe('lower');
  });

  it('keeps an already-lowercase value over a later non-lowercase duplicate in the same source', () => {
    const merged = mergeProxyAwareEnv('darwin', { HTTP_PROXY: 'later-upper', http_proxy: 'earlier-lower' });
    expect(merged.HTTP_PROXY).toBe('earlier-lower');
  });

  it('drops a whitespace-only proxy value entirely (addProxyEnvValue no-ops on blank input)', () => {
    const merged = mergeProxyAwareEnv('darwin', { HTTP_PROXY: '   ' });
    expect(merged.HTTP_PROXY).toBeUndefined();
    expect(merged.NODE_USE_ENV_PROXY).toBeUndefined();
  });
});

describe('@injini/platform — proxy-env — parseMacosScutilProxyOutput', () => {
  it('returns an empty env when nothing is enabled', () => {
    const env = parseMacosScutilProxyOutput('HTTPEnable : 0\nHTTPSEnable : 0\nSOCKSEnable : 0\n');
    expect(env).toEqual({});
  });

  it('enables HTTPS and SOCKS independently of HTTP, and brackets a bare IPv6 SOCKS host', () => {
    const scutilOutput = [
      'HTTPEnable : 0',
      'HTTPSEnable : 1',
      'HTTPSProxy : proxy.example',
      'HTTPSPort : 8443',
      'SOCKSEnable : 1',
      'SOCKSProxy : fe80::1',
      'SOCKSPort : 1080',
    ].join('\n');
    const env = parseMacosScutilProxyOutput(scutilOutput, 'darwin');
    expect(env.HTTP_PROXY).toBeUndefined();
    expect(env.HTTPS_PROXY).toBe('http://proxy.example:8443');
    expect(env.ALL_PROXY).toBe('socks5://[fe80::1]:1080');
  });

  it('honors ExcludeSimpleHostnames and an explicit "::1" exception entry', () => {
    const scutilOutput = [
      'HTTPEnable : 1',
      'HTTPProxy : proxy.example',
      'HTTPPort : 8080',
      'ExcludeSimpleHostnames : 1',
      'ExceptionsList : <array> {',
      '  0 : ::1',
      '}',
    ].join('\n');
    const env = parseMacosScutilProxyOutput(scutilOutput, 'darwin');
    expect(env.NO_PROXY).toContain('<local>');
    expect(env.NO_PROXY).toContain('[::1]');
  });

  it('preserves a wildcard "*" NO_PROXY bypass verbatim instead of expanding it', () => {
    const scutilOutput = [
      'HTTPEnable : 1',
      'HTTPProxy : proxy.example',
      'HTTPPort : 8080',
      'ExceptionsList : <array> {',
      '  0 : *',
      '}',
    ].join('\n');
    const env = parseMacosScutilProxyOutput(scutilOutput, 'darwin');
    expect(env.NO_PROXY).toBe('*');
  });

  it('omits HTTP_PROXY gracefully when HTTPEnable is on but HTTPProxy/HTTPPort scalars are missing', () => {
    const env = parseMacosScutilProxyOutput('HTTPEnable : 1\n');
    expect(env.HTTP_PROXY).toBeUndefined();
  });

  it('omits HTTP_PROXY gracefully when the host is present but the port scalar is missing', () => {
    const env = parseMacosScutilProxyOutput('HTTPEnable : 1\nHTTPProxy : proxy.example\n');
    expect(env.HTTP_PROXY).toBeUndefined();
  });

  it('passes an already-schemed HTTPProxy scalar straight through instead of double-prefixing it', () => {
    // scutil's HTTPProxy scalar is normally a bare host, but this is
    // defensively handled the same way as an already-schemed value —
    // normalizeHostPortProxyUrl composes "<host>:<port>", and if that
    // *combined* string already looks scheme-qualified (a malformed/unusual
    // scutil output), it must not get a second "http://" prefix applied.
    const env = parseMacosScutilProxyOutput('HTTPEnable : 1\nHTTPProxy : http\nHTTPPort : //proxy.example:8080\n');
    expect(env.HTTP_PROXY).toBe('http://proxy.example:8080');
  });
});

describe('@injini/platform — proxy-env — parseWindowsInternetSettingsProxyOutput', () => {
  it('parses the per-protocol http=/https=/socks= segment form, skipping malformed segments, and brackets a bare IPv6 authority', () => {
    const env = parseWindowsInternetSettingsProxyOutput({
      proxyEnable: 'ProxyEnable    REG_DWORD    0x1',
      proxyServer: 'ProxyServer    REG_SZ    http=proxy1:80;https=proxy2:443;socks=fe80::1:1080;noequalssegment;ftp=',
    });
    expect(env.HTTP_PROXY).toBe('http://proxy1:80');
    expect(env.HTTPS_PROXY).toBe('http://proxy2:443');
    expect(env.ALL_PROXY).toBe('socks5://[fe80::1]:1080');
  });

  it('returns an empty env when ProxyEnable is absent or not 1/0x1', () => {
    expect(parseWindowsInternetSettingsProxyOutput({ proxyEnable: '' })).toEqual({});
    expect(parseWindowsInternetSettingsProxyOutput({ proxyEnable: 'ProxyEnable REG_DWORD 0x0' })).toEqual({});
  });

  it('returns an empty env when ProxyServer is blank even though ProxyEnable is on', () => {
    expect(parseWindowsInternetSettingsProxyOutput({ proxyEnable: 'ProxyEnable REG_DWORD 0x1' })).toEqual({});
  });

  it('leaves an already-bracketed IPv6 authority alone', () => {
    const env = parseWindowsInternetSettingsProxyOutput({
      proxyEnable: 'ProxyEnable REG_DWORD 0x1',
      proxyServer: 'ProxyServer REG_SZ http=[::1]:8080',
    });
    expect(env.HTTP_PROXY).toBe('http://[::1]:8080');
  });

  it('leaves a colon-less authority (no port) alone', () => {
    const env = parseWindowsInternetSettingsProxyOutput({
      proxyEnable: 'ProxyEnable REG_DWORD 0x1',
      proxyServer: 'ProxyServer REG_SZ http=proxyonly',
    });
    expect(env.HTTP_PROXY).toBe('http://proxyonly');
  });

  it('leaves an authority whose colon is the very first character alone (no valid host/port split)', () => {
    const env = parseWindowsInternetSettingsProxyOutput({
      proxyEnable: 'ProxyEnable REG_DWORD 0x1',
      proxyServer: 'ProxyServer REG_SZ http=:80',
    });
    expect(env.HTTP_PROXY).toBe('http://:80');
  });

  it('passes an already-schemed shared ProxyServer value straight through', () => {
    const env = parseWindowsInternetSettingsProxyOutput({
      proxyEnable: 'ProxyEnable REG_DWORD 0x1',
      proxyServer: 'ProxyServer REG_SZ socks5://myproxy:1080',
    });
    expect(env.HTTP_PROXY).toBe('socks5://myproxy:1080');
    expect(env.HTTPS_PROXY).toBe('socks5://myproxy:1080');
  });
});

describe('@injini/platform — proxy-env — resolveSystemProxyEnv', () => {
  it('exercises the real default command runner (no injected runCommand) — forced to the darwin branch regardless of host OS', () => {
    // No `runCommand` is supplied, so this calls the *real*
    // `defaultSystemProxyCommandRunner` (a real `execFileSync`). On a
    // non-darwin CI host `scutil` doesn't exist, so the shell-out itself
    // fails — but `tryRun` swallows that, and the point of this test is
    // exercising the real default runner's own code, not what it returns.
    expect(() => resolveSystemProxyEnv({ platform: 'darwin' })).not.toThrow();
    const env = resolveSystemProxyEnv({ platform: 'darwin' });
    expect(typeof env).toBe('object');
  });

  it('defaults to process.platform when no platform override is given', () => {
    // Exercises the `options.platform ?? process.platform` fallback for
    // real: whatever this host's platform is, it must not throw, and on
    // any platform other than darwin/win32 it resolves to an empty env.
    expect(() => resolveSystemProxyEnv({ runCommand: () => '' })).not.toThrow();
    if (process.platform !== 'darwin' && process.platform !== 'win32') {
      expect(resolveSystemProxyEnv({ runCommand: () => '' })).toEqual({});
    }
  });

  it('swallows a runCommand failure and falls back to an empty parse', () => {
    const env = resolveSystemProxyEnv({
      platform: 'darwin',
      runCommand: () => {
        throw new Error('scutil is not installed here');
      },
    });
    expect(env).toEqual({});
  });

  it('resolves a Windows proxy env via three injected reg-query calls', () => {
    const env = resolveSystemProxyEnv({
      platform: 'win32',
      runCommand: (_command, args) => {
        const valueName = args[args.indexOf('/v') + 1];
        if (valueName === 'ProxyEnable') return 'ProxyEnable REG_DWORD 0x1';
        if (valueName === 'ProxyServer') return 'ProxyServer REG_SZ proxy.example:8080';
        if (valueName === 'ProxyOverride') return 'ProxyOverride REG_SZ *.local;10.0.0.1';
        return '';
      },
    });
    expect(env.HTTP_PROXY).toBe('http://proxy.example:8080');
    expect(env.HTTPS_PROXY).toBe('http://proxy.example:8080');
    expect(env.NO_PROXY).toContain('10.0.0.1');
  });

  it('returns an empty env for a platform that is neither darwin nor win32', () => {
    expect(resolveSystemProxyEnv({ platform: 'linux' })).toEqual({});
    expect(resolveSystemProxyEnv({ platform: 'freebsd', runCommand: () => 'unused' })).toEqual({});
  });
});
