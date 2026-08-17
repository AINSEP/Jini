import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SURFACE_STATUS_TEXT,
  SURFACE_BASE_CSS,
  SURFACE_CSP,
  SURFACE_SCRIPT_PRELUDE,
  SURFACE_STATUS_ELEMENT_ID,
  fieldDescribedBy,
  fieldElementId,
  renderActions,
  renderDetailList,
  renderFieldLabel,
  renderStatusRegion,
  renderSurfaceDocument,
  renderSurfaceHeader,
} from '../../surfaces/document.js';
import { SURFACE_TOKENS } from '../../surfaces/tokens.js';

const APP = { appName: 'doc-test', appVersion: '1' };

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

describe('renderSurfaceDocument', () => {
  const html = renderSurfaceDocument({ title: 'Confirm <deletion>', bodyHtml: '<p>body</p>', script: 'var a = 1;', app: APP });
  const doc = parse(html);

  it('is a complete standalone document', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(doc.querySelector('meta[charset]')).not.toBeNull();
    expect(doc.querySelector('meta[name="viewport"]')).not.toBeNull();
    expect(doc.title).toBe('Confirm <deletion>');
    expect(doc.documentElement.getAttribute('lang')).toBe('en');
  });

  it('declares every design token in the FIRST style tag, with no external stylesheet to fall back on', () => {
    const styles = doc.querySelectorAll('style');
    expect(styles).toHaveLength(1);
    for (const name of Object.keys(SURFACE_TOKENS)) expect(styles[0]?.textContent).toContain(`${name}:`);
    expect(doc.querySelector('link')).toBeNull();
  });

  it('declares a CSP that denies every outbound channel while still permitting its own inline code', () => {
    expect(doc.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content')).toBe(SURFACE_CSP);
    expect(SURFACE_CSP).toContain("default-src 'none'");
    expect(SURFACE_CSP).toContain("script-src 'unsafe-inline'");
  });

  it('emits the bridge script before the surface script, so window.jiniMcpUi exists by the time the surface runs', () => {
    const scripts = [...doc.querySelectorAll('script')].map((script) => script.textContent ?? '');
    expect(scripts).toHaveLength(2);
    expect(scripts[0]).toContain('ui/initialize');
    expect(scripts[1]).toContain('var a = 1;');
  });

  it('escapes the title into the document rather than interpolating it raw', () => {
    expect(html).toContain('<title>Confirm &lt;deletion&gt;</title>');
  });

  it('places the body inside the surface wrapper', () => {
    expect(doc.querySelector('main.mcpui-surface')?.innerHTML.trim()).toBe('<p>body</p>');
  });

  it('honors lang, token overrides and extra CSS', () => {
    const custom = renderSurfaceDocument({
      title: 't',
      bodyHtml: '',
      script: '',
      app: APP,
      lang: 'fr-CA',
      tokens: { '--jini-mcpui-accent': '#123456' },
      extraCss: '.mcpui-title { font-size: 22px; }',
    });
    const customDoc = parse(custom);
    expect(customDoc.documentElement.getAttribute('lang')).toBe('fr-CA');
    const css = customDoc.querySelector('style')?.textContent ?? '';
    expect(css).toContain('--jini-mcpui-accent: #123456;');
    // Appended after the base sheet so it wins the cascade on equal specificity.
    expect(css.indexOf('.mcpui-title { font-size: 22px; }')).toBeGreaterThan(css.indexOf(SURFACE_BASE_CSS));
  });

  it('resolves every color and radius in the base stylesheet through a token', () => {
    // A hardcoded hex here would be a value no caller could reskin, and the token block would be
    // decorative rather than load-bearing.
    expect(SURFACE_BASE_CSS).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});

describe('renderSurfaceHeader', () => {
  it('renders a single h1 and no description when none is given', () => {
    const doc = parse(renderSurfaceHeader({ title: 'Delete post?' }));
    expect(doc.querySelector('h1.mcpui-title')?.textContent).toBe('Delete post?');
    expect(doc.querySelector('.mcpui-description')).toBeNull();
  });

  it('renders and escapes a description when given one', () => {
    const doc = parse(renderSurfaceHeader({ title: 't', description: 'This <cannot> be undone' }));
    expect(doc.querySelector('.mcpui-description')?.textContent).toBe('This <cannot> be undone');
  });
});

describe('renderDetailList', () => {
  it('renders label/value pairs, escaping both', () => {
    const doc = parse(renderDetailList([{ label: 'Title', value: '<script>x</script>' }, { label: 'Slug', value: '/a' }]));
    expect([...doc.querySelectorAll('dt')].map((node) => node.textContent)).toEqual(['Title', 'Slug']);
    expect(doc.querySelectorAll('dd')[0]?.textContent).toBe('<script>x</script>');
    expect(doc.querySelector('dd script')).toBeNull();
  });

  it('renders nothing at all for an empty list, rather than an empty dl', () => {
    expect(renderDetailList([])).toBe('');
  });
});

describe('renderStatusRegion', () => {
  it('is a polite live region with the id every surface script looks up', () => {
    const node = parse(renderStatusRegion()).querySelector(`#${SURFACE_STATUS_ELEMENT_ID}`);
    expect(node?.getAttribute('role')).toBe('status');
    expect(node?.getAttribute('aria-live')).toBe('polite');
    expect(node?.getAttribute('data-state')).toBe('idle');
  });
});

describe('fieldElementId', () => {
  it.each(['name', '_private', 'a.b-c', 'x9'])('accepts %s', (name) => {
    expect(fieldElementId(name)).toBe(`mcpui-field-${name}`);
  });

  it.each(['', 'has space', '9leading', 'a b', 'a"b'])('throws on %s rather than silently rewriting the params key', (name) => {
    expect(() => fieldElementId(name)).toThrow(/Invalid MCP-UI field name/);
  });
});

describe('renderFieldLabel and fieldDescribedBy', () => {
  it('associates the label with the control and marks required fields', () => {
    const doc = parse(renderFieldLabel({ name: 'title', label: 'Title', required: true }));
    expect(doc.querySelector('label')?.getAttribute('for')).toBe('mcpui-field-title');
    expect(doc.querySelector('.mcpui-required')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('omits the required marker and the hint when neither is asked for', () => {
    const doc = parse(renderFieldLabel({ name: 'title', label: 'Title' }));
    expect(doc.querySelector('.mcpui-required')).toBeNull();
    expect(doc.querySelector('.mcpui-hint')).toBeNull();
    expect(fieldDescribedBy({ name: 'title' })).toBe('');
  });

  it('emits a hint whose id matches the aria-describedby it hands out', () => {
    const doc = parse(renderFieldLabel({ name: 'title', label: 'Title', hint: 'Shown in search results' }));
    const hintId = doc.querySelector('.mcpui-hint')?.id;
    expect(hintId).toBe('mcpui-field-title-hint');
    expect(fieldDescribedBy({ name: 'title', hint: 'x' })).toBe(` aria-describedby="${hintId}"`);
  });
});

describe('renderActions', () => {
  it('renders each variant, defaults to a neutral button, and carries no inline handler', () => {
    const html = renderActions([
      { id: 'confirm', label: 'Delete', variant: 'danger' },
      { id: 'save', label: 'Save', variant: 'primary', type: 'submit' },
      { id: 'cancel', label: 'Cancel' },
    ]);
    const buttons = [...parse(html).querySelectorAll('button')];
    expect(buttons.map((button) => button.className)).toEqual([
      'mcpui-button mcpui-button-danger',
      'mcpui-button mcpui-button-primary',
      'mcpui-button',
    ]);
    expect(buttons.map((button) => button.getAttribute('type'))).toEqual(['button', 'submit', 'button']);
    expect(buttons.map((button) => button.getAttribute('data-mcpui-action'))).toEqual(['confirm', 'save', 'cancel']);
    expect(html).not.toContain('onclick');
  });

  it('renders an explicit neutral variant the same as an omitted one', () => {
    expect(renderActions([{ id: 'a', label: 'A', variant: 'neutral' }])).toBe(renderActions([{ id: 'a', label: 'A' }]));
  });

  it('tags each button with the @jini-ai/agentic data-agent-* markup so a driver reaching directly into the frame (frameLocator) can find and label it', () => {
    const html = renderActions([
      { id: 'confirm', label: 'Publish', variant: 'danger' },
      { id: 'cancel', label: 'Cancel' },
    ]);
    const buttons = [...parse(html).querySelectorAll('button')];
    expect(buttons.map((button) => button.getAttribute('data-agent-element'))).toEqual([
      'mcpui-action-confirm',
      'mcpui-action-cancel',
    ]);
    expect(buttons.map((button) => button.getAttribute('data-agent-role'))).toEqual(['button', 'button']);
    expect(buttons.map((button) => button.getAttribute('data-agent-label'))).toEqual(['Publish', 'Cancel']);
  });
});

describe('SURFACE_SCRIPT_PRELUDE', () => {
  it('binds the bridge global and the status node the fragment helpers emit', () => {
    expect(SURFACE_SCRIPT_PRELUDE).toContain('window.jiniMcpUi');
    expect(SURFACE_SCRIPT_PRELUDE).toContain(JSON.stringify(SURFACE_STATUS_ELEMENT_ID));
    expect(SURFACE_SCRIPT_PRELUDE).toContain('[data-mcpui-action]');
  });

  it('ships English defaults for every runtime string', () => {
    expect(Object.values(DEFAULT_SURFACE_STATUS_TEXT).every((value) => value.length > 0)).toBe(true);
  });
});
