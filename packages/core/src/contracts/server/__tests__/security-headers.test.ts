import { expect, test } from 'vitest';

import { addDeclaredHostsToPolicy, CSP_REPORT_ONLY_HEADER, withDeclaredHosts } from '../security-headers.js';

test('a page adds its declared hosts to the matching directives only, never twice or as policy text', () => {
  const policy = "default-src 'self'; script-src 'self' https://a.test; frame-src 'self' https://b.test; connect-src 'self'; object-src 'none'";
  expect(addDeclaredHostsToPolicy({ policy, hosts: { script: ['https://c.test', 'https://a.test'], frame: ['https://d.test'], connect: ['https://e.test'] } })).toBe(
    "default-src 'self'; script-src 'self' https://a.test https://c.test; frame-src 'self' https://b.test https://d.test; connect-src 'self' https://e.test; object-src 'none'");
  expect(addDeclaredHostsToPolicy({ policy, hosts: { script: ["https://c.test; object-src *", "'unsafe-eval'", 'https://x.test/path'], frame: [], connect: [] } })).toBe(policy);
});

test('headers without a report-only policy retain the same object identity', () => {
  const headers = { 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "script-src 'self'" };
  expect(withDeclaredHosts({ headers, hosts: { script: ['https://c.test'], frame: [], connect: [] } })).toBe(headers);
});

test('invalid declarations are dropped from their directives', () => {
  const policy = "script-src 'self'; frame-src 'self'; connect-src 'self'";
  const invalid = ["https://c.test; object-src *", "'unsafe-eval'", 'https://c.test/path', 'javascript:alert(1)'];
  expect(addDeclaredHostsToPolicy({ policy, hosts: { script: invalid, frame: invalid, connect: invalid } })).toBe(policy);
});

test('canonical HTTP script origins are accepted', () => {
  expect(addDeclaredHostsToPolicy({ policy: "script-src 'self'", hosts: { script: ['http://c.test'], frame: [], connect: [] } })).toBe("script-src 'self' http://c.test");
});

test('duplicate declarations and hosts already in the policy appear once', () => {
  expect(addDeclaredHostsToPolicy({
    policy: "script-src 'self' https://a.test; frame-src 'self'; connect-src 'self'",
    hosts: { script: ['https://a.test', 'https://c.test', 'https://c.test'], frame: ['https://d.test', 'https://d.test'], connect: ['https://e.test', 'https://e.test'] },
  })).toBe("script-src 'self' https://a.test https://c.test; frame-src 'self' https://d.test; connect-src 'self' https://e.test");
});

test('a policy without script-src gains no script directive', () => {
  const policy = "default-src 'self'; object-src 'none'";
  expect(addDeclaredHostsToPolicy({ policy, hosts: { script: ['https://c.test'], frame: [], connect: [] } })).toBe(policy);
});

test('directive matching is exact or followed by a space and leaves script-src-elem unchanged', () => {
  expect(addDeclaredHostsToPolicy({
    policy: "script-src; script-src-elem 'self'; script-src 'self'; frame-src; connect-src",
    hosts: { script: ['https://c.test'], frame: ['https://d.test'], connect: ['https://e.test'] },
  })).toBe("script-src https://c.test; script-src-elem 'self'; script-src 'self' https://c.test; frame-src https://d.test; connect-src https://e.test");
});

test('only the report-only policy is extended and other header values are preserved', () => {
  const headers = { 'Content-Security-Policy-Report-Only': "script-src 'self'", 'X-Content-Type-Options': 'nosniff' };
  expect(CSP_REPORT_ONLY_HEADER).toBe('Content-Security-Policy-Report-Only');
  expect(withDeclaredHosts({ headers, hosts: { script: ['https://c.test'], frame: [], connect: [] } })).toEqual({
    'Content-Security-Policy-Report-Only': "script-src 'self' https://c.test",
    'X-Content-Type-Options': 'nosniff',
  });
});
