import { describe, expect, it } from 'vitest';
import {
  htmlNeedsFocusGuard,
  htmlNeedsSandboxShim,
  parseForceInline,
  shouldUrlLoadHtmlPreview,
  type UrlLoadDecision,
} from '../url-load-decision.js';

function decision(overrides: Partial<UrlLoadDecision> = {}): UrlLoadDecision {
  return { mode: 'preview', forceInline: false, ...overrides };
}

describe('shouldUrlLoadHtmlPreview', () => {
  it('url-loads by default in preview mode', () => {
    expect(shouldUrlLoadHtmlPreview(decision())).toBe(true);
  });

  it('never url-loads in source mode', () => {
    expect(shouldUrlLoadHtmlPreview(decision({ mode: 'source' }))).toBe(false);
  });

  it('respects an explicit forceInline opt-in', () => {
    expect(shouldUrlLoadHtmlPreview(decision({ forceInline: true }))).toBe(false);
  });

  it('routes through srcDoc when the focus guard is needed', () => {
    expect(shouldUrlLoadHtmlPreview(decision({ needsFocusGuard: true }))).toBe(false);
  });

  it('routes through srcDoc when an active bridge requires it', () => {
    const bridgesRequiringSrcDoc = new Set(['deck-html']);
    expect(
      shouldUrlLoadHtmlPreview(decision({ activeBridgeIds: ['deck-html'] }), bridgesRequiringSrcDoc),
    ).toBe(false);
  });

  it('url-loads when the active bridge does not require srcDoc', () => {
    const bridgesRequiringSrcDoc = new Set(['deck-html']);
    expect(
      shouldUrlLoadHtmlPreview(decision({ activeBridgeIds: ['some-other-bridge'] }), bridgesRequiringSrcDoc),
    ).toBe(true);
  });
});

describe('parseForceInline', () => {
  it.each(['1', 'true', 'YES', 'On'])('accepts %s', (value) => {
    expect(parseForceInline(`forceInline=${value}`)).toBe(true);
  });

  it.each(['0', 'false', 'nah', ''])('rejects %s', (value) => {
    expect(parseForceInline(`forceInline=${value}`)).toBe(false);
  });

  it('returns false when the param is missing', () => {
    expect(parseForceInline('other=1')).toBe(false);
  });

  it('returns false for null/undefined input', () => {
    expect(parseForceInline(null)).toBe(false);
    expect(parseForceInline(undefined)).toBe(false);
  });

  it('accepts a URLSearchParams instance directly', () => {
    expect(parseForceInline(new URLSearchParams('forceInline=1'))).toBe(true);
  });
});

describe('htmlNeedsFocusGuard', () => {
  it('detects inline .focus( calls', () => {
    expect(htmlNeedsFocusGuard('<script>window.focus();</script>')).toBe(true);
  });

  it('detects the autofocus attribute', () => {
    expect(htmlNeedsFocusGuard('<input autofocus>')).toBe(true);
  });

  it('detects external scripts conservatively', () => {
    expect(htmlNeedsFocusGuard('<script src="app.js"></script>')).toBe(true);
  });

  it('returns false for plain markup', () => {
    expect(htmlNeedsFocusGuard('<div>hello</div>')).toBe(false);
  });
});

describe('htmlNeedsSandboxShim', () => {
  it('detects babel-standalone script tags', () => {
    expect(htmlNeedsSandboxShim('<script type="text/babel">1</script>')).toBe(true);
  });

  it('detects direct localStorage/sessionStorage mentions', () => {
    expect(htmlNeedsSandboxShim('<script>localStorage.getItem("x")</script>')).toBe(true);
    expect(htmlNeedsSandboxShim('<script>sessionStorage.setItem("x", "1")</script>')).toBe(true);
  });

  it('detects external scripts conservatively', () => {
    expect(htmlNeedsSandboxShim('<script src="boot.js"></script>')).toBe(true);
  });

  it('returns false for inert markup', () => {
    expect(htmlNeedsSandboxShim('<div>hello</div>')).toBe(false);
  });
});
