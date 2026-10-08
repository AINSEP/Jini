import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { isBlockedExternalApiHostname, isLoopbackApiHost } from '../endpoint-policy.js';
import { isBlockedExternalApiHostname as nodeBlocked, isLoopbackApiHost as nodeLoopback } from '../address.js';

// Absolute answers protect the contract even when all adapters share one owner.
// Literal-host inspection is deliberately separate from DNS and isPrivateAddress.
const HOSTS = [
  ['localhost', true, false], ['LOCALHOST...', true, false],
  ['localhost.example.com', false, false], ['internal.example.com', false, false],
  ['127.0.0.0', true, false], ['127.255.255.255.', true, false],
  ['127.000.000.001', true, false], ['127.256.0.1', false, false],
  ['0.0.0.0', false, true], ['0.255.255.255', false, true],
  ['10.0.0.0', false, true], ['10.255.255.255...', false, true],
  ['100.63.255.255', false, false], ['100.64.0.0', false, true],
  ['100.127.255.255', false, true], ['100.128.0.0', false, false],
  ['169.253.255.255', false, false], ['169.254.0.0', false, true],
  ['169.254.255.255', false, true], ['169.255.0.0', false, false],
  ['172.15.255.255', false, false], ['172.16.0.0', false, true],
  ['172.31.255.255', false, true], ['172.32.0.0', false, false],
  ['192.167.255.255', false, false], ['192.168.0.0', false, true],
  ['192.168.255.255', false, true], ['192.169.0.0', false, false],
  ['223.255.255.255', false, false], ['224.0.0.0', false, true],
  ['255.255.255.255', false, true], ['8.8.8.8', false, false],
  ['[::1]', true, false], ['::', false, true],
  ['[FC00::1]', false, true], ['fdff::1', false, true],
  ['fe7f::1', false, false], ['fe80::1', false, true],
  ['febf::1', false, true], ['fec0::1', false, false],
  ['::ffff:127.0.0.1', true, false], ['[::FFFF:7F00:1]', true, false],
  ['::ffff:10.0.0.1', false, true], ['[::ffff:a00:1]', false, true],
  ['::ffff:8.8.8.8', false, false], ['::ffff:808:808', false, false],
  ['::ffff:1:2:3', false, false], ['::ffff:zzzz:1', false, false],
  ['999.0.0.1', false, false], ['10.0.0', false, false],
  ['10.0.0.1.example.com', false, false], ['', false, false],
  [' localhost ', false, false], ['\u00a010.0.0.1\u00a0', false, false],
] as const;

describe('literal endpoint hostname contract', () => {
  it('publishes the pure policy as a universal entry without Node imports', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));
    expect(manifest.jini.entries['./net/endpoint-policy']).toBe('universal');
    expect(manifest.exports['./net/endpoint-policy']).toEqual({
      types: './dist/net/endpoint-policy.d.ts',
      import: './dist/net/endpoint-policy.js',
      default: './dist/net/endpoint-policy.js',
    });
    const source = readFileSync(new URL('../endpoint-policy.ts', import.meta.url), 'utf8');
    expect(source.match(/^\s*(?:import\b|export\s+[^\n]*\bfrom\b)/gm)).toBeNull();
  });

  it('keeps the Node API exports as the exact same predicates', () => {
    expect(nodeLoopback).toBe(isLoopbackApiHost);
    expect(nodeBlocked).toBe(isBlockedExternalApiHostname);
  });
  it.each(HOSTS)('classifies %j without changing its loopback exception or blocked range', (hostname, loopback, blocked) => {
    expect(isLoopbackApiHost({ hostname })).toBe(loopback);
    expect(isBlockedExternalApiHostname({ hostname })).toBe(blocked);
  });
});
