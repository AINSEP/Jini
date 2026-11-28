// @vitest-environment jsdom
/** useProviderSettingsFocus against a real DOM (jsdom): the hook runs inside a mounted React tree and
 * moves real focus, read back through `document.activeElement`. Its own file because the sibling
 * dialog suite renders to static markup in the node environment, where effects never run.
 *
 * Requirement-to-test map:
 * - the native dialog takes focus on open, before the card loads; once a card with fields arrives,
 *   focus moves to its FIRST field (`<fieldId>-<field name>`).
 * - no card, a card with no fields, or a first field with no rendered input leaves focus alone.
 * - a re-render that keeps the same first field does not pull focus back from where the user moved it.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useProviderSettingsFocus, type ProviderSettingsCard, type ProviderSettingFieldShape } from '../PluginProviderSettingsDialog.js';

const field = (name: string): ProviderSettingFieldShape => ({ name, label: name, secret: false, required: false, saved: false });
const card = (names: readonly string[], rendered: readonly string[] = names): { card: ProviderSettingsCard; rendered: readonly string[] } => ({
  card: { pluginId: 'maps', store: 'site', appliesAt: 'now', usedByThisSite: true, usedBy: [], fields: names.map(field) },
  rendered,
});

/** The slice of jsdom's `document` this suite touches. The package compiles without the DOM lib, so the
 * environment's global is read through this structural view rather than the DOM's own types. */
interface FocusTarget { readonly id: string; focus(): void }
interface TestContainer { remove(): void }
interface TestDocument {
  getElementById(id: string): FocusTarget | null;
  readonly activeElement: { readonly id: string } | null;
  createElement(tag: 'div'): TestContainer;
  readonly body: { append(node: TestContainer): void };
}
const document = (globalThis as unknown as { document: TestDocument }).document;

function Harness({ loaded, note }: { loaded: { card: ProviderSettingsCard; rendered: readonly string[] } | null; note?: string }) {
  useProviderSettingsFocus({ card: loaded?.card ?? null, fieldId: 'settings', document });
  return (
    <div>
      <button id="dialog-close">Close</button>
      {loaded?.rendered.map((name) => <input key={name} id={`settings-${name}`} aria-label={name} />)}
      <p>{note}</p>
    </div>
  );
}

let host: TestContainer;
let root: Root;
const activeId = () => document.activeElement?.id;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
});

/** Renders, then gives the dialog its open-time focus (as the native dialog does) when asked. */
function show(props: Parameters<typeof Harness>[0], { focusDialog = false } = {}): void {
  act(() => root.render(<Harness {...props} />));
  if (focusDialog) document.getElementById('dialog-close')?.focus();
}

describe('useProviderSettingsFocus', () => {
  it('leaves the dialog focus alone while the card loads, then moves focus to the first field once it arrives', () => {
    show({ loaded: null }, { focusDialog: true });
    expect(activeId()).toBe('dialog-close');
    show({ loaded: card(['apiKey', 'region']) });
    expect(activeId()).toBe('settings-apiKey');
  });

  it('a card with no fields, or a first field with no rendered input, keeps focus where it was', () => {
    show({ loaded: card([]) }, { focusDialog: true });
    expect(activeId()).toBe('dialog-close');
    show({ loaded: card(['apiKey', 'region'], ['region']) });
    expect(activeId()).toBe('dialog-close');
  });

  it('a re-render with the same first field does not pull focus back from the field the user moved to', () => {
    show({ loaded: card(['apiKey', 'region']) });
    expect(activeId()).toBe('settings-apiKey');
    document.getElementById('settings-region')?.focus();
    show({ loaded: card(['apiKey', 'region']), note: 'typing' });
    expect(activeId()).toBe('settings-region');
  });
});
