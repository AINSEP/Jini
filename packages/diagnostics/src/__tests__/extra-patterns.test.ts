import { describe, expect, it } from 'vitest';
import { redactLocalText } from '../local-text.js';
import { redactedError } from '../observability/report-error.js';
import { redactText } from '../redaction.js';

// A host-owned key shape Jini's built-in catalog cannot know about (hosts inject their own prefixes).
const HOST_KEY = 'acme_k_0123456789ab.SuperSecretValueThatMustNotLeak1234';
const extraPatterns = [{ name: 'acme_key', regex: /(?<=acme_k_[0-9a-f]{12}\.)[A-Za-z0-9_-]{20,}/g }];

describe('host-injected extraPatterns', () => {
  it('redactText blanks a host key shape and keeps the public prefix', () => {
    const out = redactText({ text: `login failed for ${HOST_KEY}` }, { extraPatterns });
    expect(out).toBe('login failed for acme_k_0123456789ab.[REDACTED]');
  });

  it('redactText leaves the host key alone without the option (baseline is host-neutral)', () => {
    expect(redactText({ text: HOST_KEY })).toBe(HOST_KEY);
  });

  it('redactText accepts a non-global pattern and still replaces every match', () => {
    const once = [{ name: 'acme_key', regex: /acme_k_[0-9a-f]{12}\.[A-Za-z0-9_-]{20,}/ }];
    expect(redactText({ text: `${HOST_KEY} ${HOST_KEY}` }, { extraPatterns: once })).toBe('[REDACTED] [REDACTED]');
  });

  it('redactLocalText forwards extraPatterns to the shared redactor', () => {
    const out = redactLocalText({ text: `child stderr: ${HOST_KEY}` }, { homeDir: '/home/ada', extraPatterns });
    expect(out).toBe('child stderr: acme_k_0123456789ab.[REDACTED]');
  });

  it('redactedError blanks a host key shape in message and stack', () => {
    const error = new Error(`upstream rejected ${HOST_KEY}`);
    const out = redactedError({ error }, { extraPatterns });
    expect(out.message).not.toContain('SuperSecretValue');
    expect(out.message).toContain('acme_k_0123456789ab.');
    expect(out.stack).not.toContain('SuperSecretValue');
  });

  it('redactedError blanks a host key shape in a non-Error throw', () => {
    expect(redactedError({ error: `boom ${HOST_KEY}` }, { extraPatterns }).message).not.toContain('SuperSecretValue');
  });
});
