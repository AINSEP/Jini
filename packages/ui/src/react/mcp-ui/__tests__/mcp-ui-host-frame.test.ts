import { describe, expect, it } from 'vitest';
import { resolveFrameHeight, resolveThemedViewSession } from '../mcp-ui-host-frame.js';

const SURFACE = '<style>:root { --jini-mcpui-accent: #363636; }</style><p>card</p>';

describe('resolveThemedViewSession', () => {
  it('passes the document through untouched and keys by the session key before the host is measured', () => {
    expect(resolveThemedViewSession({ html: SURFACE, sessionKey: 's', hostTokens: undefined })).toEqual({ html: SURFACE, sessionKey: 's' });
  });

  it('keys by the document itself when no session key is given', () => {
    expect(resolveThemedViewSession({ html: '<p>x</p>', sessionKey: undefined, hostTokens: undefined }).sessionKey).toBe('<p>x</p>');
  });

  it('stringifies a numeric session key', () => {
    expect(resolveThemedViewSession({ html: '<p>x</p>', sessionKey: 7, hostTokens: undefined }).sessionKey).toBe('7');
  });

  it('leaves a third-party document and its key unchanged when the host has tokens', () => {
    const tokens = { '--jini-mcpui-accent': '#0055ff' } as const;
    expect(resolveThemedViewSession({ html: '<p>third party</p>', sessionKey: 'k', hostTokens: tokens })).toEqual({ html: '<p>third party</p>', sessionKey: 'k' });
  });

  it('re-themes a Jini surface and folds the tokens into its key', () => {
    const tokens = { '--jini-mcpui-accent': '#0055ff' } as const;
    const session = resolveThemedViewSession({ html: SURFACE, sessionKey: 'k', hostTokens: tokens });
    expect(session.html).not.toBe(SURFACE);
    expect(session.html).toContain('#0055ff');
    expect(session.sessionKey).toBe(`k${JSON.stringify(tokens)}`);
  });
});

describe('resolveFrameHeight', () => {
  it('uses the default 220px initial height before any report', () => {
    expect(resolveFrameHeight({ reported: undefined })).toBe(220);
  });

  it('uses the given initial height before any report', () => {
    expect(resolveFrameHeight({ reported: undefined }, { initialHeight: 90 })).toBe(90);
  });

  it('follows the reported height', () => {
    expect(resolveFrameHeight({ reported: 410 })).toBe(410);
  });

  it('clamps to the default 720px ceiling', () => {
    expect(resolveFrameHeight({ reported: 9000 })).toBe(720);
  });

  it('clamps to the given ceiling', () => {
    expect(resolveFrameHeight({ reported: 9000 }, { maxHeight: 300 })).toBe(300);
  });

  it('never goes below 1px', () => {
    expect(resolveFrameHeight({ reported: -5 })).toBe(1);
  });

  it('ignores the report when autoResize is off', () => {
    expect(resolveFrameHeight({ reported: 410 }, { autoResize: false })).toBe(220);
  });
});
