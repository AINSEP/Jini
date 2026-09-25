import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AGENT_ELEMENT_ATTRIBUTE, isValidElementHandle } from '@jini-ai/agentic';
import {
  sourceConfigActionHandle,
  sourceConfigAddFormHandle,
  sourceConfigAgentProps,
  sourceConfigFieldHandle,
  sourceConfigItemHandles,
} from './agent-handles.js';
import { validateSourceDraft } from './rules.js';
import { SourceConfigAddForm } from './react/components/SourceConfigAddForm.js';
import { SourceConfigField } from './react/components/SourceConfigField.js';
import { SourceConfigItemCard } from './react/components/SourceConfigItemCard.js';
import { SourceConfigListView } from './react/components/SourceConfigListView.js';
import { SourceConfigTestControl } from './react/components/SourceConfigTestControl.js';
import type { SourceConfigListCapabilities } from './react/hooks/useSourceConfigList.js';
import type { SourceConfigItem, SourceFieldSpec } from './types.js';

/**
 * @file Covers the whole `agentHandle` surface of `source-config-list` — the derivation rules in
 * `agent-handles.ts` and the markup all four components emit from them — in one file, because it
 * is one feature: an agent addressing this form has to see a single coherent handle namespace, and
 * the properties worth asserting (uniqueness, stability, opt-out) are cross-component by nature.
 */

const URL_FIELD: SourceFieldSpec = { key: 'url', label: 'URL', kind: 'url' };
const SECRET_FIELD: SourceFieldSpec = { key: 'oauthClientSecret', label: 'Client secret', kind: 'password' };

const FULL_CAPS: SourceConfigListCapabilities = {
  canRefresh: true,
  canSetTrust: true,
  canTest: true,
  canUpdate: true,
};

/** Every published handle in `root`, in document order. */
function handlesIn(root: ParentNode): string[] {
  return Array.from(root.querySelectorAll(`[${AGENT_ELEMENT_ATTRIBUTE}]`)).map(
    (element) => element.getAttribute(AGENT_ELEMENT_ATTRIBUTE) ?? '',
  );
}

function addFormProps(overrides: Partial<Parameters<typeof SourceConfigAddForm>[0]> = {}) {
  return {
    fieldSpecs: [URL_FIELD],
    values: {},
    validation: { ok: true, issues: [] },
    submitAttempted: false,
    submitting: false,
    onFieldChange: vi.fn(),
    onTrustChange: vi.fn(),
    onSubmit: vi.fn(),
    ...overrides,
  } as Parameters<typeof SourceConfigAddForm>[0];
}

function itemCardProps(overrides: Partial<Parameters<typeof SourceConfigItemCard>[0]> = {}) {
  const source: SourceConfigItem = { id: 's1', enabled: true, fields: { url: 'https://a.example' } };
  return {
    source,
    fieldSpecs: [URL_FIELD],
    capabilities: FULL_CAPS,
    removing: false,
    refreshing: false,
    settingTrust: false,
    testing: false,
    updating: false,
    onRefresh: vi.fn(),
    onRemove: vi.fn(),
    onTrustChange: vi.fn(),
    onTest: vi.fn(),
    onUpdate: vi.fn(),
    ...overrides,
  } as Parameters<typeof SourceConfigItemCard>[0];
}

function listViewProps(overrides: Partial<Parameters<typeof SourceConfigListView>[0]> = {}) {
  const values = { url: '' };
  return {
    fieldSpecs: [URL_FIELD],
    sources: [] as SourceConfigItem[],
    loading: false,
    capabilities: FULL_CAPS,
    pendingKeys: new Set<string>(),
    testResults: {},
    addForm: {
      values,
      validation: validateSourceDraft([URL_FIELD], values),
      submitAttempted: false,
      submitting: false,
      onFieldChange: vi.fn(),
      onTrustChange: vi.fn(),
      onSubmit: vi.fn(),
    },
    onRefresh: vi.fn(),
    onRemove: vi.fn(),
    onTrustChange: vi.fn(),
    onTest: vi.fn(),
    onUpdate: vi.fn(),
    ...overrides,
  } as Parameters<typeof SourceConfigListView>[0];
}

describe('handle derivation', () => {
  it('names an action directly under the base', () => {
    expect(sourceConfigActionHandle('mcp-add', 'submit')).toBe('mcp-add-submit');
  });

  it('kebab-cases a camelCase field key into the -field- namespace', () => {
    expect(sourceConfigFieldHandle('mcp-add', 'oauthClientSecret')).toBe('mcp-add-field-oauth-client-secret');
  });

  it.each([
    ['api_key', 'mcp-add-field-api-key'],
    ['Base URL', 'mcp-add-field-base-url'],
    ['  spaced  ', 'mcp-add-field-spaced'],
  ])('sanitizes a host field key that is not already a valid handle (%s)', (key, expected) => {
    expect(sourceConfigFieldHandle('mcp-add', key)).toBe(expected);
  });

  it('degrades a field key with nothing usable left in it to a resolvable handle rather than throwing', () => {
    // A throw here would take down the whole settings surface for one bad field spec.
    expect(sourceConfigFieldHandle('mcp-add', '***')).toBe('mcp-add-field-unnamed');
  });

  it.each(['url', 'oauthClientSecret', 'api_key', 'Base URL', '***', 'Ünïcödé'])(
    'produces a handle the agentic layer will actually resolve, for key %s',
    (key) => {
      expect(isValidElementHandle(sourceConfigFieldHandle('mcp-add', key))).toBe(true);
    },
  );

  it('emits nothing at all when the host published no base handle', () => {
    expect(sourceConfigAgentProps(undefined, { role: 'button', label: 'Save' })).toEqual({});
  });

  it('publishes the base itself when no action is named', () => {
    expect(sourceConfigAgentProps('mcp-add', { role: 'form', label: 'Add server' })).toEqual({
      'data-agent-element': 'mcp-add',
      'data-agent-role': 'form',
      'data-agent-label': 'Add server',
    });
  });

  it('publishes base-plus-action when one is named', () => {
    expect(sourceConfigAgentProps('mcp-add', { role: 'button', label: 'Add server', action: 'submit' })).toEqual({
      'data-agent-element': 'mcp-add-submit',
      'data-agent-role': 'button',
      'data-agent-label': 'Add server',
    });
  });

  it('throws on a base handle the host got wrong, rather than answering to a name it never wrote', () => {
    expect(() => sourceConfigAgentProps('Mcp Add', { role: 'form', label: 'Add server' })).toThrow(
      'invalid element handle "Mcp Add": handles are lowercase words joined by single hyphens, and are never CSS selectors',
    );
  });

  it('derives the add form base from the list base', () => {
    expect(sourceConfigAddFormHandle('mcp')).toBe('mcp-add');
  });

  it("derives each item card's base from its own stable id, not its position", () => {
    expect(sourceConfigItemHandles('mcp', ['higgsfield', 'github'])).toEqual([
      'mcp-item-higgsfield',
      'mcp-item-github',
    ]);
  });

  it('never lets an item card base collide with the add form base', () => {
    // A source id of "add" is ordinary host data; the `-item-` namespace is what keeps it from
    // landing on the same handle as `sourceConfigAddFormHandle`'s own `<base>-add`.
    expect(sourceConfigItemHandles('mcp', ['add'])).toEqual(['mcp-item-add']);
    expect(sourceConfigItemHandles('mcp', ['add'])[0]).not.toBe(sourceConfigAddFormHandle('mcp'));
  });

  it('keeps two ids that slugify identically apart, delegating dedup to @jini-ai/agentic', () => {
    expect(sourceConfigItemHandles('mcp', ['My_Server', 'my.server'])).toEqual([
      'mcp-item-my-server',
      'mcp-item-my-server-2',
    ]);
  });
});

describe('SourceConfigField markup', () => {
  it('tags the control and derives the show-hide toggle from the same base', () => {
    const { container } = render(
      <SourceConfigField spec={SECRET_FIELD} value="" agentHandle="mcp-add-field-secret" onChange={vi.fn()} />,
    );
    expect(handlesIn(container)).toEqual(['mcp-add-field-secret', 'mcp-add-field-secret-reveal']);
    expect(screen.getByDisplayValue('')).toHaveAttribute('data-agent-role', 'field');
    expect(screen.getByRole('button')).toHaveAttribute('data-agent-role', 'button');
  });

  it('labels the toggle by the field it reveals, so the label does not flip when it is clicked', async () => {
    render(<SourceConfigField spec={SECRET_FIELD} value="" agentHandle="mcp-add-field-secret" onChange={vi.fn()} />);
    const toggle = screen.getByRole('button');
    const before = toggle.getAttribute('data-agent-label');
    expect(before).toBe('Show or hide Client secret');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('data-agent-label', before ?? '');
    expect(toggle).toHaveAttribute('title', 'Hide');
  });

  it.each<SourceFieldSpec['kind']>(['text', 'url', 'password', 'select', 'textarea', 'secret-textarea'])(
    'tags the primary control for a %s-kind field',
    (kind) => {
      const spec: SourceFieldSpec = { key: 'f', label: 'F', kind, options: [{ value: 'a', label: 'A' }] };
      const { container } = render(<SourceConfigField spec={spec} value="" agentHandle="mcp-f" onChange={vi.fn()} />);
      expect(handlesIn(container)[0]).toBe('mcp-f');
    },
  );

  it('emits no data-agent-* markup at all when agentHandle is omitted', () => {
    const { container } = render(<SourceConfigField spec={SECRET_FIELD} value="" onChange={vi.fn()} />);
    expect(container.querySelectorAll('[data-agent-element], [data-agent-role], [data-agent-label]')).toHaveLength(0);
  });
});

describe('SourceConfigTestControl markup', () => {
  it('publishes the button under the base and the status line under -status', () => {
    const { container } = render(
      <SourceConfigTestControl running={false} agentHandle="mcp-add-test" onTest={vi.fn()} />,
    );
    expect(handlesIn(container)).toEqual(['mcp-add-test-status', 'mcp-add-test']);
  });

  it('keeps the status handle mounted before any test has run, so a caller can read its own result later', () => {
    const { container } = render(
      <SourceConfigTestControl running={false} agentHandle="mcp-add-test" onTest={vi.fn()} />,
    );
    const status = container.querySelector('[data-agent-element="mcp-add-test-status"]');
    expect(status).not.toBeNull();
    expect(status?.textContent).toBe('');
  });

  it('emits no data-agent-* markup at all when agentHandle is omitted', () => {
    const { container } = render(<SourceConfigTestControl running={false} onTest={vi.fn()} />);
    expect(handlesIn(container)).toEqual([]);
  });
});

describe('SourceConfigAddForm markup', () => {
  it('publishes the form, every field, the trust selector, the test control and submit', () => {
    const { container } = render(
      <SourceConfigAddForm
        {...addFormProps({
          fieldSpecs: [URL_FIELD, SECRET_FIELD],
          trustOptions: [{ value: 'trusted', label: 'Trusted' }],
          canTest: true,
          onTest: vi.fn(),
          addLabel: 'Add server',
          agentHandle: 'mcp-add',
        })}
      />,
    );
    expect(handlesIn(container)).toEqual([
      'mcp-add',
      'mcp-add-field-url',
      'mcp-add-field-oauth-client-secret',
      'mcp-add-field-oauth-client-secret-reveal',
      'mcp-add-trust',
      'mcp-add-test-status',
      'mcp-add-test',
      'mcp-add-submit',
    ]);
  });

  it('publishes a field the moment it appears in fieldSpecs, so a reactive host stays addressable', () => {
    const { container, rerender } = render(<SourceConfigAddForm {...addFormProps({ agentHandle: 'mcp-add' })} />);
    expect(handlesIn(container)).not.toContain('mcp-add-field-oauth-client-secret');

    rerender(
      <SourceConfigAddForm {...addFormProps({ fieldSpecs: [URL_FIELD, SECRET_FIELD], agentHandle: 'mcp-add' })} />,
    );
    expect(handlesIn(container)).toContain('mcp-add-field-oauth-client-secret');
  });

  it('emits no data-agent-* markup at all when agentHandle is omitted', () => {
    const { container } = render(
      <SourceConfigAddForm {...addFormProps({ canTest: true, onTest: vi.fn(), trustOptions: [{ value: 't', label: 'T' }] })} />,
    );
    expect(handlesIn(container)).toEqual([]);
  });
});

describe('SourceConfigItemCard markup', () => {
  it('publishes the card and its collapsed-row controls', () => {
    const { container } = render(
      <SourceConfigItemCard
        {...itemCardProps({ trustOptions: [{ value: 'trusted', label: 'Trusted' }], agentHandle: 'mcp-server-1' })}
      />,
    );
    expect(handlesIn(container)).toEqual([
      'mcp-server-1',
      'mcp-server-1-enabled',
      'mcp-server-1-expand',
      'mcp-server-1-trust',
      'mcp-server-1-refresh',
      'mcp-server-1-remove',
    ]);
  });

  it('publishes the edit controls only once expanded and editing — the sequence a caller has to walk', async () => {
    const { container } = render(<SourceConfigItemCard {...itemCardProps({ agentHandle: 'mcp-server-1' })} />);
    expect(handlesIn(container)).not.toContain('mcp-server-1-edit');

    await userEvent.click(container.querySelector('[data-agent-element="mcp-server-1-expand"]') as HTMLElement);
    expect(handlesIn(container)).toContain('mcp-server-1-edit');
    expect(handlesIn(container)).not.toContain('mcp-server-1-field-url');

    await userEvent.click(container.querySelector('[data-agent-element="mcp-server-1-edit"]') as HTMLElement);
    const editing = handlesIn(container);
    expect(editing).toEqual(
      expect.arrayContaining([
        'mcp-server-1-save',
        'mcp-server-1-cancel',
        'mcp-server-1-label',
        'mcp-server-1-field-url',
        'mcp-server-1-test',
        'mcp-server-1-test-status',
      ]),
    );
    expect(editing).not.toContain('mcp-server-1-edit');
  });

  it('emits no data-agent-* markup at all when agentHandle is omitted', async () => {
    const { container } = render(<SourceConfigItemCard {...itemCardProps()} />);
    await userEvent.click(screen.getByRole('button', { name: /a\.example/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(handlesIn(container)).toEqual([]);
  });
});

describe('handle uniqueness across a whole rendered surface', () => {
  // The reason fields sit under a `-field-` namespace. A host is free to key its source shape
  // however it likes, and `remove`/`save`/`test` are perfectly ordinary field names — but they are
  // also this feature's own action names. Colliding would not fail loudly: it would make
  // `page.click`/`page.fill` ambiguous on exactly the controls a caller most wants, and the FIRST
  // match wins silently. Asserted on the fully-expanded, mid-edit card, which is the only state
  // where every field handle and every action handle are mounted at the same time.
  const COLLIDING_SPECS: SourceFieldSpec[] = [
    { key: 'remove', label: 'Remove hook', kind: 'text' },
    { key: 'save', label: 'Save hook', kind: 'text' },
    { key: 'test', label: 'Test hook', kind: 'text' },
    { key: 'label', label: 'Label field', kind: 'text' },
  ];

  it('never publishes the same handle twice, even when host field keys are named after this feature\'s own actions', async () => {
    const { container } = render(
      <SourceConfigItemCard
        {...itemCardProps({
          source: { id: 's1', enabled: true, fields: {} },
          fieldSpecs: COLLIDING_SPECS,
          trustOptions: [{ value: 'trusted', label: 'Trusted' }],
          agentHandle: 'mcp-server-1',
        })}
      />,
    );
    await userEvent.click(container.querySelector('[data-agent-element="mcp-server-1-expand"]') as HTMLElement);
    await userEvent.click(container.querySelector('[data-agent-element="mcp-server-1-edit"]') as HTMLElement);

    const handles = handlesIn(container);
    expect(new Set(handles).size).toBe(handles.length);
    // And specifically: the field keyed `remove` did NOT land on the Remove button's handle.
    expect(handles).toContain('mcp-server-1-field-remove');
    expect(handles).toContain('mcp-server-1-remove');
  });

  it('never publishes the same handle twice across the add form either', () => {
    const { container } = render(
      <SourceConfigAddForm
        {...addFormProps({
          fieldSpecs: COLLIDING_SPECS,
          trustOptions: [{ value: 'trusted', label: 'Trusted' }],
          canTest: true,
          onTest: vi.fn(),
          agentHandle: 'mcp-add',
        })}
      />,
    );
    const handles = handlesIn(container);
    expect(new Set(handles).size).toBe(handles.length);
    expect(handles).toContain('mcp-add-field-save');
    expect(handles).toContain('mcp-add-submit');
  });
});

describe('SourceConfigListView markup — the list-level scheme', () => {
  // `SourceConfigList`/`SourceConfigListView` were deliberately left out of the original
  // `agentHandle` rollout (see this module's "list-level scheme" doc) because deriving N distinct
  // card handles from N arbitrary source ids didn't have a shared, tested policy yet. It does now
  // (`@jini-ai/agentic`'s `buildAgentListHandles`), so this is the first place the whole list — add
  // form plus every card — is addressable from one host-supplied base.
  const SOURCES: SourceConfigItem[] = [
    { id: 'higgsfield', enabled: true, fields: { url: 'https://higgsfield.example' } },
    { id: 'github', enabled: true, fields: { url: 'https://github.example' } },
  ];

  it('derives the add form and every item card from one base, keyed by stable id', () => {
    const { container } = render(
      <SourceConfigListView {...listViewProps({ sources: SOURCES, agentHandle: 'mcp' })} />,
    );
    expect(handlesIn(container)).toEqual(
      expect.arrayContaining(['mcp-add', 'mcp-item-higgsfield', 'mcp-item-github']),
    );
  });

  it('keeps a card handle stable when the list is reordered, since it is keyed by id not position', () => {
    const { container, rerender } = render(
      <SourceConfigListView {...listViewProps({ sources: SOURCES, agentHandle: 'mcp' })} />,
    );
    const before = container.querySelectorAll('[data-testid="source-config-item-card"]');
    expect(before[0]).toHaveAttribute(AGENT_ELEMENT_ATTRIBUTE, 'mcp-item-higgsfield');

    rerender(<SourceConfigListView {...listViewProps({ sources: [...SOURCES].reverse(), agentHandle: 'mcp' })} />);
    const after = container.querySelectorAll('[data-testid="source-config-item-card"]');
    // "github" is now first in render order, but still answers to its own id-derived handle.
    expect(after[0]).toHaveAttribute(AGENT_ELEMENT_ATTRIBUTE, 'mcp-item-github');
    expect(after[1]).toHaveAttribute(AGENT_ELEMENT_ATTRIBUTE, 'mcp-item-higgsfield');
  });

  it('never publishes the same handle twice across the add form and every card, even with adversarial ids', () => {
    const adversarial: SourceConfigItem[] = [
      { id: 'add', enabled: true, fields: {} },
      { id: 'Add', enabled: true, fields: {} },
    ];
    const { container } = render(
      <SourceConfigListView {...listViewProps({ sources: adversarial, agentHandle: 'mcp' })} />,
    );
    const handles = handlesIn(container);
    expect(new Set(handles).size).toBe(handles.length);
    expect(handles).toContain('mcp-add'); // the add form itself — not shadowed by the "add"-id card
  });

  it("lets an explicit addForm.agentHandle win over the list-level base's own derived one", () => {
    const { container } = render(
      <SourceConfigListView
        {...listViewProps({
          sources: SOURCES,
          agentHandle: 'mcp',
          addForm: { ...listViewProps().addForm, agentHandle: 'custom-add' },
        })}
      />,
    );
    const handles = handlesIn(container);
    expect(handles).toContain('custom-add');
    expect(handles).not.toContain('mcp-add');
  });

  it('emits no data-agent-* markup at all when the list published no base handle', () => {
    const { container } = render(<SourceConfigListView {...listViewProps({ sources: SOURCES })} />);
    expect(handlesIn(container)).toEqual([]);
  });
});
