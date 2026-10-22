import { describe, expect, it } from 'vitest';
import { DEFAULT_AGENT_INSTALL_LINKS, installMetaForAgent } from '../metadata.js';

describe('installMetaForAgent', () => {
  it('returns an empty object for an unknown agent id', () => {
    expect(installMetaForAgent({ agentId: 'not-a-real-agent' })).toEqual({});
  });

  it('returns both installUrl and docsUrl for an agent that declares both', () => {
    const meta = installMetaForAgent({ agentId: 'claude' });
    expect(meta.installUrl).toBe('https://docs.anthropic.com/en/docs/claude-code/setup');
    expect(meta.docsUrl).toBe('https://docs.anthropic.com/en/docs/claude-code');
  });

  it('omits installUrl when the table entry has none (hermes/pi shape)', () => {
    const meta = installMetaForAgent({ agentId: 'hermes' });
    expect(meta.installUrl).toBeUndefined();
    expect(meta.docsUrl).toBe('https://hermes-agent.nousresearch.com/docs/');
  });

  it('rejects a non-https installUrl/docsUrl', () => {
    const meta = installMetaForAgent({ agentId: 'x' }, { table: {
      x: { installUrl: 'http://insecure.example', docsUrl: 'ftp://also-bad.example' },
    } });
    expect(meta).toEqual({});
  });

  it('rejects a malformed URL string', () => {
    const meta = installMetaForAgent({ agentId: 'x' }, { table: { x: { installUrl: 'not a url at all' } } });
    expect(meta.installUrl).toBeUndefined();
  });

  it('accepts an injected table overriding the default', () => {
    const meta = installMetaForAgent({ agentId: 'claude' }, { table: { claude: { installUrl: 'https://example.com/install' } } });
    expect(meta).toEqual({ installUrl: 'https://example.com/install' });
  });

  it('defaults to DEFAULT_AGENT_INSTALL_LINKS when no table is supplied', () => {
    expect(installMetaForAgent({ agentId: 'amp' })).toEqual(DEFAULT_AGENT_INSTALL_LINKS.amp);
  });

  it('never includes the origin OD-self-referential entries for amr/pi/hermes install/docs URLs', () => {
    expect(DEFAULT_AGENT_INSTALL_LINKS.amr).toBeUndefined();
    expect(DEFAULT_AGENT_INSTALL_LINKS.pi?.installUrl).toBeUndefined();
    expect(DEFAULT_AGENT_INSTALL_LINKS.hermes?.installUrl).toBeUndefined();
  });
});
