import { describe, expect, it } from 'vitest';
import * as core from '../index.js';
import {
  AGENT_FAILURE_SECRET_SHAPE_RE,
  CREDENTIAL_FILE_DENY_SEGMENTS,
  LOCAL_OWNER_PROXY_MARKER_PREFIXES,
  LOCAL_OWNER_PROXY_MARKER_HEADERS,
} from '../redact.js';

describe('baseline security vocabulary', () => {
  // The JWT alternative only gained a linear-time guard; its matches must equal the original's.
  it('matches exactly what the original agent-failure expression matched, with the global flag', () => {
    const original = /\b(?:AIza[\w-]+|AQ\.[\w.\/-]+|sk-[\w.-]+|gh[pousr]_[\w]+|github_pat_[\w]+|ya29\.[\w.-]+|eyJ[\w-]+\.[\w-]+(?:\.[\w-]+)?)/g;
    expect(AGENT_FAILURE_SECRET_SHAPE_RE.flags).toBe('g');
    const corpus = [
      'eyJa.b', 'x-eyJa.b.c', 'eyJa-eyJb.c', 'aeyJb.c', '_eyJb.c', 'eyJ-eyJ-eyJ', 'eyJa-eyJb', 'ghp_x-eyJa.b',
      'AIza-eyJa.b', 'sk-eyJa.b', 'eyJa.eyJb.eyJc.eyJd', '-eyJa.b -eyJc.d', 'eyJ-'.repeat(50) + '.x',
    ];
    for (const text of corpus) {
      expect([...text.matchAll(AGENT_FAILURE_SECRET_SHAPE_RE)].map(m => [m.index, m[0]]))
        .toEqual([...text.matchAll(original)].map(m => [m.index, m[0]]));
    }
  });

  it.each([
    'AIzaA-_9', 'AQ.a/b.c-d', 'sk-a.b-c_d', 'ghp_a', 'gho_a', 'ghu_a', 'ghs_a', 'ghr_a',
    'github_pat_a', 'ya29.a.b-c_d', 'eyJabc.def', 'eyJabc.def.ghi',
  ])('matches existing short token shapes: %s', token => {
    expect(`failure: ${token}!`.replace(AGENT_FAILURE_SECRET_SHAPE_RE, '[REDACTED]')).toBe('failure: [REDACTED]!');
  });

  it.each(['AIza', 'AQ.', 'sk-', 'ghp_', 'ghx_a', 'github_pat_', 'ya29.', 'eyJabc', 'xsk-secret'])('preserves near misses: %s', text => {
    expect(text.replace(AGENT_FAILURE_SECRET_SHAPE_RE, '[REDACTED]')).toBe(text);
  });

  it('replaces multiple tokens and remains stable across repeat calls', () => {
    for (let call = 0; call < 3; call++) {
      expect('sk-short ghp_short github_pat_short'.replace(AGENT_FAILURE_SECRET_SHAPE_RE, '[REDACTED]'))
        .toBe('[REDACTED] [REDACTED] [REDACTED]');
    }
  });

  it('pins every credential directory and its order, including the protected site-key directory', () => {
    expect(CREDENTIAL_FILE_DENY_SEGMENTS).toEqual(['secrets', '.aws', '.docker', '.kube', 'gcloud', 'gh']);
  });

  it('pins every proxy prefix and exact header in order', () => {
    expect(LOCAL_OWNER_PROXY_MARKER_PREFIXES).toEqual(['x-forwarded-', 'x-envoy-', 'x-ms-']);
    expect(LOCAL_OWNER_PROXY_MARKER_HEADERS).toEqual([
      'forwarded', 'x-real-ip', 'via', 'cf-connecting-ip', 'true-client-ip', 'x-original-host',
      'x-client-ip', 'x-cluster-client-ip', 'fastly-client-ip', 'tailscale-user-login', 'x-original-forwarded-for',
    ]);
  });

  it('exports the same vocabulary through the public root', () => {
    expect(core.AGENT_FAILURE_SECRET_SHAPE_RE).toBe(AGENT_FAILURE_SECRET_SHAPE_RE);
    expect(core.CREDENTIAL_FILE_DENY_SEGMENTS).toBe(CREDENTIAL_FILE_DENY_SEGMENTS);
    expect(core.LOCAL_OWNER_PROXY_MARKER_PREFIXES).toBe(LOCAL_OWNER_PROXY_MARKER_PREFIXES);
    expect(core.LOCAL_OWNER_PROXY_MARKER_HEADERS).toBe(LOCAL_OWNER_PROXY_MARKER_HEADERS);
  });
});
