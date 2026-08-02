import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../i18n/index.js';
import { createFakeSourceConfigDependencies } from '../../dependencies.js';
import type { SourceConfigItem, SourceFieldSpec, SourceTrustOption } from '../../types.js';
import { SourceConfigList } from './SourceConfigList.js';
import type { SourceConfigListController } from '../hooks/useSourceConfigList.js';
import type { SourceConfigAddFormController } from '../hooks/useSourceConfigAddForm.js';

/**
 * Proof that the generic `SourceConfigList<TSource>` primitive really holds
 * across the two most different origin shapes it consolidates: an
 * MCP-server-shaped source (a `url` field + a trust level, no secret) and a
 * BYOK-key-shaped source (an `apiKey` field, no trust concept at all) — same
 * component, different injected `dependencies`/`fieldSpecs`/`trustOptions`.
 */

interface McpServerSource extends SourceConfigItem {
  fields: { url: string };
}

const MCP_FIELD_SPECS: SourceFieldSpec[] = [{ key: 'url', label: 'URL', kind: 'url', required: true }];
const MCP_TRUST_OPTIONS: SourceTrustOption[] = [
  { value: 'restricted', label: 'Restricted' },
  { value: 'trusted', label: 'Trusted' },
];

function mcpDependencies(seed: McpServerSource[] = []) {
  return createFakeSourceConfigDependencies<McpServerSource>({
    sources: seed,
    createSource: (input) => ({
      id: `mcp-${Object.keys(input.fields).length}-${input.fields.url}`,
      fields: { url: input.fields.url ?? '' },
      ...(input.trust !== undefined ? { trust: input.trust } : {}),
    }),
    supportsTrust: true,
    supportsRefresh: true,
    supportsTest: false,
  });
}

interface ByokKeySource extends SourceConfigItem {
  fields: { apiKey: string; model: string };
}

const BYOK_FIELD_SPECS: SourceFieldSpec[] = [
  { key: 'apiKey', label: 'API Key', kind: 'password', required: true },
  { key: 'model', label: 'Model', kind: 'text', required: true },
];

function byokDependencies(seed: ByokKeySource[] = []) {
  let nextId = 0;
  return createFakeSourceConfigDependencies<ByokKeySource>({
    sources: seed,
    createSource: (input) => ({
      id: `byok-${nextId++}`,
      fields: { apiKey: input.fields.apiKey ?? '', model: input.fields.model ?? '' },
    }),
    supportsTrust: false,
    supportsRefresh: false,
    supportsTest: true,
    onTest: () => ({ ok: true, message: 'Connected in 12ms.' }),
  });
}

describe('SourceConfigList — MCP-server-shaped source', () => {
  it('loads existing sources and renders trust badges', async () => {
    const dependencies = mcpDependencies([{ id: 'a', fields: { url: 'https://mcp.example/a' }, trust: 'trusted' }]);
    render(
      <SourceConfigList<McpServerSource>
        dependencies={dependencies}
        fieldSpecs={MCP_FIELD_SPECS}
        trustOptions={MCP_TRUST_OPTIONS}
      />,
    );
    expect(await screen.findByText('https://mcp.example/a')).toBeInTheDocument();
    const card = screen.getByTestId('source-config-item-card');
    expect(card.querySelector('.source-config-item-card-trust-badge')?.textContent).toBe('Trusted');
  });

  it('adds a new MCP-shaped source with a trust level through the generic add form', async () => {
    const dependencies = mcpDependencies();
    render(
      <SourceConfigList<McpServerSource>
        dependencies={dependencies}
        fieldSpecs={MCP_FIELD_SPECS}
        trustOptions={MCP_TRUST_OPTIONS}
      />,
    );
    await waitFor(() => expect(screen.getByText('No sources configured yet.')).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText('URL', { exact: false }), 'https://mcp.example/new');
    await userEvent.selectOptions(screen.getByLabelText('Trust level'), 'trusted');
    await userEvent.click(screen.getByRole('button', { name: 'Add source' }));

    expect(await screen.findByText('https://mcp.example/new')).toBeInTheDocument();
    const card = screen.getByTestId('source-config-item-card');
    expect(card.querySelector('.source-config-item-card-trust-badge')?.textContent).toBe('Trusted');
    expect((await dependencies.port.fetchSources())).toHaveLength(1);
  });

  it('changes an existing item\'s trust level through its own per-item select', async () => {
    const dependencies = mcpDependencies([{ id: 'a', fields: { url: 'https://mcp.example/a' }, trust: 'restricted' }]);
    render(
      <SourceConfigList<McpServerSource>
        dependencies={dependencies}
        fieldSpecs={MCP_FIELD_SPECS}
        trustOptions={MCP_TRUST_OPTIONS}
      />,
    );
    await screen.findByText('https://mcp.example/a');
    const card = screen.getByTestId('source-config-item-card');
    await userEvent.selectOptions(within(card).getByRole('combobox', { name: /Trust level for/ }), 'trusted');
    await waitFor(() =>
      expect(card.querySelector('.source-config-item-card-trust-badge')?.textContent).toBe('Trusted'),
    );
    const persisted = await dependencies.port.fetchSources();
    expect(persisted[0]?.trust).toBe('trusted');
  });

  it('refreshes and removes an item, and never renders a test control (this shape has no test capability)', async () => {
    const dependencies = mcpDependencies([{ id: 'a', fields: { url: 'https://mcp.example/a' } }]);
    render(<SourceConfigList<McpServerSource> dependencies={dependencies} fieldSpecs={MCP_FIELD_SPECS} />);
    await screen.findByText('https://mcp.example/a');

    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh' })).not.toBeDisabled());

    await userEvent.click(screen.getByRole('button', { name: 'https://mcp.example/a' }));
    expect(screen.queryByRole('button', { name: 'Test' })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(screen.queryByText('https://mcp.example/a')).toBeNull());
    expect(screen.getByText('No sources configured yet.')).toBeInTheDocument();
  });

  /**
   * Regression, end-to-end through the real orchestrator: the audit's exact
   * finding was that `types.ts` declares `SourceConfigItem.enabled`, but
   * nothing in the shipped port/UI ever rendered or mutated it, and the
   * expanded card was entirely read-only — real OD `McpClientSection.tsx`'s
   * `McpRow` supports both an always-visible enable/disable toggle and
   * expand-to-edit label/field inputs. This drives the real always-visible
   * checkbox and the real expanded Edit/Save flow against an injected port,
   * and asserts the persisted source actually changed (via `fetchSources()`
   * after the round trip), not just that a callback fired.
   */
  it('toggles enabled and edits the label/fields of a real MCP-shaped server end-to-end', async () => {
    const dependencies = mcpDependencies([
      { id: 'a', label: 'Old label', fields: { url: 'https://mcp.example/a' }, enabled: true },
    ]);
    render(
      <SourceConfigList<McpServerSource> dependencies={dependencies} fieldSpecs={MCP_FIELD_SPECS} trustOptions={MCP_TRUST_OPTIONS} />,
    );
    await screen.findByText('Old label');

    // Enable/disable toggle: always visible, no need to expand first.
    const checkbox = screen.getByRole('checkbox', { name: /Enable/ });
    expect(checkbox).toBeChecked();
    await userEvent.click(checkbox);
    await waitFor(() => expect(checkbox).not.toBeChecked());
    let persisted = await dependencies.port.fetchSources();
    expect(persisted[0]?.enabled).toBe(false);

    // Expand-to-edit: label + field.
    const card = screen.getByTestId('source-config-item-card');
    await userEvent.click(within(card).getByRole('button', { name: 'Old label' }));
    await userEvent.click(within(card).getByRole('button', { name: 'Edit' }));
    const labelInput = within(card).getByLabelText('Label');
    await userEvent.clear(labelInput);
    await userEvent.type(labelInput, 'New label');
    const urlInput = within(card).getByLabelText('URL', { exact: false });
    await userEvent.clear(urlInput);
    await userEvent.type(urlInput, 'https://mcp.example/renamed');
    await userEvent.click(within(card).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'New label' })).toBeInTheDocument());
    persisted = await dependencies.port.fetchSources();
    expect(persisted[0]?.label).toBe('New label');
    expect(persisted[0]?.fields.url).toBe('https://mcp.example/renamed');
    // Explicit timeout: this test drives many sequential userEvent
    // interactions (toggle, expand, edit two fields, save) against a real
    // mounted tree, which can exceed the default 5s under full-package
    // parallel test-suite contention even though it runs in ~1s in isolation.
  }, 20000);
});

describe('SourceConfigList — BYOK-key-shaped source (same component, different fields/adapter)', () => {
  it('adds a new API-key-shaped source, masks the key, and never renders a trust control', async () => {
    const dependencies = byokDependencies();
    render(<SourceConfigList<ByokKeySource> dependencies={dependencies} fieldSpecs={BYOK_FIELD_SPECS} />);
    await waitFor(() => expect(screen.getByText('No sources configured yet.')).toBeInTheDocument());

    expect(screen.queryByLabelText('Trust level')).toBeNull();

    await userEvent.type(screen.getByLabelText('API Key', { exact: false }), 'sk-ant-1234567890wxyz');
    await userEvent.type(screen.getByLabelText('Model', { exact: false }), 'claude-sonnet-4-5');
    await userEvent.click(screen.getByRole('button', { name: 'Add source' }));

    // No explicit `label`, so the summary shows the masked first field (apiKey).
    const card = await screen.findByTestId('source-config-item-card');
    expect(within(card).queryByText('sk-ant-1234567890wxyz')).toBeNull();
    expect(within(card).getByText(/wxyz$/)).toBeInTheDocument();
    expect(within(card).queryByRole('combobox')).toBeNull();
  });

  it('runs a per-item connection test using the injected byok-shaped test adapter', async () => {
    const dependencies = byokDependencies([{ id: 'k1', fields: { apiKey: 'sk-ant-1', model: 'claude-sonnet-4-5' } }]);
    render(<SourceConfigList<ByokKeySource> dependencies={dependencies} fieldSpecs={BYOK_FIELD_SPECS} />);
    const card = await screen.findByTestId('source-config-item-card');
    await userEvent.click(within(card).getByRole('button', { name: /wxyz$|1$/ }));
    await userEvent.click(within(card).getByRole('button', { name: 'Test' }));
    expect(await within(card).findByRole('status')).toHaveTextContent('Connected in 12ms.');
    // No refresh capability for this shape.
    expect(within(card).queryByRole('button', { name: /Refresh/ })).toBeNull();
  });

  /**
   * Regression, end-to-end through the real orchestrator: the audit's exact
   * finding was that `ports.ts`'s `testSource(id, draft?)` promised support
   * for testing an unsaved draft, but the shipped add form had no test
   * control at all and the orchestrator only ever called `list.test(id)`
   * for an already-persisted item — an unrepresentable contract. This drives
   * the real add-form BEFORE any submit, clicks its own "Test" control, and
   * asserts the port's `testSource` was called with `id === undefined` (no
   * persisted item exists yet) and the CURRENT draft field values — the
   * real BYOK "test before save" shape (real OD's `testProviderInline`
   * calls its test endpoint with only the current form values, no id).
   */
  it('tests the add form\'s unsaved draft before any submit (BYOK "test before save")', async () => {
    const onTest = vi.fn((id: string | undefined, draft: Record<string, string> | undefined) => ({
      ok: true,
      message: id === undefined ? 'Draft reachable.' : 'Persisted reachable.',
    }));
    const dependencies = createFakeSourceConfigDependencies<ByokKeySource>({
      createSource: (input) => ({ id: 'byok-0', fields: { apiKey: input.fields.apiKey ?? '', model: input.fields.model ?? '' } }),
      supportsTrust: false,
      supportsRefresh: false,
      supportsTest: true,
      onTest: (id, draft) => onTest(id, draft),
    });
    render(<SourceConfigList<ByokKeySource> dependencies={dependencies} fieldSpecs={BYOK_FIELD_SPECS} />);
    await waitFor(() => expect(screen.getByText('No sources configured yet.')).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText('API Key', { exact: false }), 'sk-ant-draft-key');
    await userEvent.type(screen.getByLabelText('Model', { exact: false }), 'claude-sonnet-4-5');
    await userEvent.click(screen.getByRole('button', { name: 'Test' }));

    expect(onTest).toHaveBeenCalledWith(undefined, { apiKey: 'sk-ant-draft-key', model: 'claude-sonnet-4-5' });
    expect(await screen.findByText('Draft reachable.')).toBeInTheDocument();
    // Nothing was persisted — the draft is still in the form, no item card exists.
    expect(screen.queryByTestId('source-config-item-card')).toBeNull();
  });

  it('disables the add form\'s Test control until required fields are filled', async () => {
    const dependencies = byokDependencies();
    render(<SourceConfigList<ByokKeySource> dependencies={dependencies} fieldSpecs={BYOK_FIELD_SPECS} />);
    await waitFor(() => expect(screen.getByText('No sources configured yet.')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Test' })).toBeDisabled();
  });
});

describe('SourceConfigList — i18n wiring', () => {
  it('renders translated copy when mounted under an I18nProvider with a matching dictionary', async () => {
    const dependencies = mcpDependencies();
    render(
      <I18nProvider
        dictionaries={{
          fr: {
            'Add source': 'Ajouter une source',
            'No sources configured yet.': 'Aucune source configurée.',
            URL: 'URL',
          },
        }}
        initialLocale="fr"
      >
        <SourceConfigList<McpServerSource> dependencies={dependencies} fieldSpecs={MCP_FIELD_SPECS} />
      </I18nProvider>,
    );
    await waitFor(() => expect(screen.getByText('Aucune source configurée.')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Ajouter une source' })).toBeInTheDocument();
  });

  /**
   * Regression for the audit finding that the original i18n smoke test's
   * identity `URL -> URL` dictionary entry, and its lack of an invalid
   * submission, could never detect a hardcoded/unwrapped validation message:
   * `rules.ts`'s `validateSourceDraft` used to build a pre-baked English
   * sentence (`` `${spec.label} is required.` ``) that rendered straight
   * through `SourceConfigField`'s `error` prop with no `t()` wrapping
   * anywhere in the chain. This submits the form empty (a real invalid
   * submission) under a dictionary that translates BOTH the field label and
   * the now-templated validation message, and asserts the fully-translated
   * sentence renders — not just the field label alone.
   */
  it('translates a real validation error (not just passthrough copy) on an invalid submission', async () => {
    const dependencies = mcpDependencies();
    render(
      <I18nProvider
        dictionaries={{
          fr: {
            URL: 'Adresse URL',
            '{label} is required.': '{label} est requis.',
          },
        }}
        initialLocale="fr"
      >
        <SourceConfigList<McpServerSource> dependencies={dependencies} fieldSpecs={MCP_FIELD_SPECS} />
      </I18nProvider>,
    );
    await waitFor(() => expect(screen.getByLabelText('Adresse URL', { exact: false })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Add source' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Adresse URL est requis.');
  });

  /** Regression for host-supplied field placeholders/select-option labels rendering raw. */
  it('translates host-supplied field placeholder and select option labels under a matching dictionary', async () => {
    interface ProtocolSource extends SourceConfigItem {
      fields: { protocol: string };
    }
    const fieldSpecs: SourceFieldSpec[] = [
      {
        key: 'protocol',
        label: 'Protocol',
        kind: 'select',
        placeholder: 'Choose a protocol',
        options: [{ value: 'anthropic', label: 'Anthropic' }],
      },
    ];
    const dependencies = createFakeSourceConfigDependencies<ProtocolSource>({
      createSource: (input) => ({ id: 'p1', fields: { protocol: input.fields.protocol ?? '' } }),
    });
    render(
      <I18nProvider dictionaries={{ fr: { Protocol: 'Protocole', Anthropic: 'Anthropique' } }} initialLocale="fr">
        <SourceConfigList<ProtocolSource> dependencies={dependencies} fieldSpecs={fieldSpecs} />
      </I18nProvider>,
    );
    expect(await screen.findByLabelText('Protocole', { exact: false })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Anthropique' })).toBeInTheDocument();
  });
});

describe('SourceConfigList — title/subtitle/emptyMessage/addLabel passthrough', () => {
  it('forwards optional presentational props to the view', async () => {
    const dependencies = mcpDependencies();
    render(
      <SourceConfigList<McpServerSource>
        dependencies={dependencies}
        fieldSpecs={MCP_FIELD_SPECS}
        title="MCP servers"
        subtitle="Connect external tools."
        emptyMessage="No servers yet."
        addLabel="Add server"
      />,
    );
    expect(screen.getByRole('heading', { name: 'MCP servers' })).toBeInTheDocument();
    expect(screen.getByText('Connect external tools.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('No servers yet.')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Add server' })).toBeInTheDocument();
  });
});

describe('SourceConfigList 4-pattern hook override test suite', () => {
  it('Pattern 1 — State 1: Loading list state via hook override', () => {
    // Explicit return-type annotations here (rather than relying purely on
    // the `as any` cast below) mean tsc still catches an invented/misnamed
    // field in the object literal itself via excess-property checking — the
    // `as any` is only there to bridge the generic-vs-concrete mismatch
    // between `typeof useWiredSourceConfigList` and this fixed McpServerSource
    // shape, not to silence real field-shape drift.
    const customListHook = (): SourceConfigListController<McpServerSource> => ({
      sources: [],
      loading: true,
      error: null,
      capabilities: { canSetTrust: false, canRefresh: false, canTest: false, canUpdate: false },
      pendingKeys: new Set<string>(),
      testResults: {},
      addSourceToList: vi.fn(),
      setTrust: vi.fn(),
      refresh: vi.fn(),
      remove: vi.fn(),
      test: vi.fn(),
      update: vi.fn(),
      isPending: () => false,
      reload: vi.fn(),
    });

    const customAddFormHook = (): SourceConfigAddFormController => ({
      values: {},
      trust: 'always',
      validation: { ok: false, issues: [] },
      submitAttempted: false,
      submitting: false,
      submitError: null,
      setField: vi.fn(),
      setTrust: vi.fn(),
      submit: vi.fn(),
    });

    render(
      <SourceConfigList<McpServerSource>
        dependencies={mcpDependencies()}
        fieldSpecs={MCP_FIELD_SPECS}
        useWiredSourceConfigList={customListHook as any}
        useWiredSourceConfigAddForm={customAddFormHook as any}
      />,
    );

    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('Pattern 2 — State 2: Configured sources list state via hook override', () => {
    const sources: McpServerSource[] = [{ id: 's1', fields: { url: 'https://mcp.server' } }];
    const customListHook = (): SourceConfigListController<McpServerSource> => ({
      sources,
      loading: false,
      error: null,
      capabilities: { canSetTrust: false, canRefresh: false, canTest: false, canUpdate: false },
      pendingKeys: new Set<string>(),
      testResults: {},
      addSourceToList: vi.fn(),
      setTrust: vi.fn(),
      refresh: vi.fn(),
      remove: vi.fn(),
      test: vi.fn(),
      update: vi.fn(),
      isPending: () => false,
      reload: vi.fn(),
    });

    const customAddFormHook = (): SourceConfigAddFormController => ({
      values: {},
      trust: 'always',
      validation: { ok: false, issues: [] },
      submitAttempted: false,
      submitting: false,
      submitError: null,
      setField: vi.fn(),
      setTrust: vi.fn(),
      submit: vi.fn(),
    });

    render(
      <SourceConfigList<McpServerSource>
        dependencies={mcpDependencies()}
        fieldSpecs={MCP_FIELD_SPECS}
        useWiredSourceConfigList={customListHook as any}
        useWiredSourceConfigAddForm={customAddFormHook as any}
      />,
    );

    expect(screen.getByText('https://mcp.server')).toBeInTheDocument();
  });

  it('Pattern 3 — State 3: Submitting add form state via hook override', () => {
    const customListHook = (): SourceConfigListController<McpServerSource> => ({
      sources: [],
      loading: false,
      error: null,
      capabilities: { canSetTrust: false, canRefresh: false, canTest: false, canUpdate: false },
      pendingKeys: new Set<string>(),
      testResults: {},
      addSourceToList: vi.fn(),
      setTrust: vi.fn(),
      refresh: vi.fn(),
      remove: vi.fn(),
      test: vi.fn(),
      update: vi.fn(),
      isPending: () => false,
      reload: vi.fn(),
    });

    const customAddFormHook = (): SourceConfigAddFormController => ({
      values: { url: 'https://submitting.server' },
      trust: 'always',
      validation: { ok: true, issues: [] },
      submitAttempted: true,
      submitting: true,
      submitError: null,
      setField: vi.fn(),
      setTrust: vi.fn(),
      submit: vi.fn(),
    });

    render(
      <SourceConfigList<McpServerSource>
        dependencies={mcpDependencies()}
        fieldSpecs={MCP_FIELD_SPECS}
        useWiredSourceConfigList={customListHook as any}
        useWiredSourceConfigAddForm={customAddFormHook as any}
      />,
    );

    expect(screen.getByRole('button', { name: 'Adding…' })).toBeDisabled();
  });

  it('Pattern 4 — State 4: Dynamic form input value transition walkthrough using React useState inside test harness', () => {
    const dependencies = mcpDependencies();
    render(<SourceConfigList<McpServerSource> dependencies={dependencies} fieldSpecs={MCP_FIELD_SPECS} />);

    const input = screen.getByLabelText('URL', { exact: false });
    fireEvent.change(input, { target: { value: 'https://test-mcp.org' } });

    expect(input).toHaveValue('https://test-mcp.org');
  });
});
