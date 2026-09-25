import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../i18n/index.js';
import { SourceConfigItemCard } from './SourceConfigItemCard.js';
import type { ComponentProps } from 'react';
import type { SourceConfigListCapabilities } from '../hooks/useSourceConfigList.js';
import type { SourceConfigItem, SourceFieldSpec, SourceTrustOption } from '../../types.js';

const URL_FIELD: SourceFieldSpec = { key: 'url', label: 'URL', kind: 'url' };
const KEY_FIELD: SourceFieldSpec = { key: 'apiKey', label: 'API Key', kind: 'password' };
const TRUST_OPTIONS: SourceTrustOption[] = [
  { value: 'restricted', label: 'Restricted' },
  { value: 'trusted', label: 'Trusted' },
];
const FULL_CAPS: SourceConfigListCapabilities = { canRefresh: true, canSetTrust: true, canTest: true, canUpdate: true };
const NO_CAPS: SourceConfigListCapabilities = { canRefresh: false, canSetTrust: false, canTest: false, canUpdate: false };

function baseProps(overrides: Partial<ComponentProps<typeof SourceConfigItemCard>> = {}) {
  const source: SourceConfigItem = { id: 's1', fields: { url: 'https://a.example' } };
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
  };
}

/**
 * The shipped stylesheet, read from source — same technique as
 * `ByokProviderForm.layout.test.tsx`'s own `CSS`/`ruleBody`. Needed because the Edit/Save/Cancel
 * text-color regression below is a CSS-cascade defect: jsdom renders the real "Save"/"Cancel" text
 * nodes regardless (an RTL `getByRole('button', { name: 'Save' })` query is accessible-name-based
 * and passes whether or not the text is visible), so the only way to catch a MISSING `color`
 * declaration is to read the rule itself, not the rendered DOM.
 */
const CSS = readFileSync(resolve('src/features/settings/dialog/styles/settings-dialog.css'), 'utf8');

/** The declarations of one CSS rule, by selector. */
function ruleBody(selector: string): string {
  const at = CSS.indexOf(`${selector} {`);
  expect(at, `no rule for ${selector} in settings-dialog.css`).toBeGreaterThan(-1);
  return CSS.slice(at, CSS.indexOf('}', at));
}

describe('SourceConfigItemCard', () => {
  it('renders the display label from the source fields when no explicit label is set', () => {
    render(<SourceConfigItemCard {...baseProps()} />);
    expect(screen.getByText('https://a.example')).toBeInTheDocument();
  });

  it('starts collapsed: field details are not shown until expanded', () => {
    render(<SourceConfigItemCard {...baseProps()} />);
    expect(screen.queryByText('URL')).toBeNull();
  });

  it('expands to show masked field values on click', async () => {
    const source: SourceConfigItem = { id: 's1', fields: { apiKey: 'sk-ant-1234567890wxyz' } };
    const { container } = render(<SourceConfigItemCard {...baseProps({ source, fieldSpecs: [KEY_FIELD] })} />);
    // The summary label itself is also masked (no explicit `label`, and the
    // one field is password-kind — see rules.ts's `sourceDisplayLabel`).
    await userEvent.click(screen.getByRole('button', { name: /wxyz$/ }));
    expect(screen.getByText('API Key')).toBeInTheDocument();
    const maskedValue = container.querySelector('.source-config-item-card-fields dd');
    expect(maskedValue?.textContent).toMatch(/^•+wxyz$/);
    expect(screen.queryByText('sk-ant-1234567890wxyz')).toBeNull();
  });

  it('collapses again on a second click', async () => {
    render(<SourceConfigItemCard {...baseProps()} />);
    const toggle = screen.getByRole('button', { name: 'https://a.example' });
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('renders a trust badge when the source has a trust value, using the option label when known', () => {
    const source: SourceConfigItem = { id: 's1', fields: {}, trust: 'trusted' };
    const { container } = render(<SourceConfigItemCard {...baseProps({ source, trustOptions: TRUST_OPTIONS })} />);
    expect(container.querySelector('.source-config-item-card-trust-badge')?.textContent).toBe('Trusted');
  });

  it('falls back to the raw trust value in the badge when no matching option exists', () => {
    const source: SourceConfigItem = { id: 's1', fields: {}, trust: 'mystery' };
    render(<SourceConfigItemCard {...baseProps({ source })} />);
    expect(screen.getByText('mystery')).toBeInTheDocument();
  });

  it('renders no trust badge when the source has no trust value', () => {
    render(<SourceConfigItemCard {...baseProps()} />);
    expect(screen.queryByText('Restricted')).toBeNull();
  });

  it('renders a trust select and reports changes when canSetTrust and trustOptions are both present', async () => {
    const source: SourceConfigItem = { id: 's1', fields: {}, trust: 'restricted' };
    const onTrustChange = vi.fn();
    render(<SourceConfigItemCard {...baseProps({ source, trustOptions: TRUST_OPTIONS, onTrustChange })} />);
    const select = screen.getByDisplayValue('Restricted');
    await userEvent.selectOptions(select, 'trusted');
    expect(onTrustChange).toHaveBeenCalledWith('trusted');
  });

  it('does not render a trust select when capabilities.canSetTrust is false, even with trustOptions given', () => {
    render(<SourceConfigItemCard {...baseProps({ capabilities: NO_CAPS, trustOptions: TRUST_OPTIONS })} />);
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('does not render a trust select when trustOptions is omitted, even with canSetTrust true', () => {
    render(<SourceConfigItemCard {...baseProps({ capabilities: FULL_CAPS })} />);
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('renders the trust select defaulted to empty when the source has no trust value yet', () => {
    const source: SourceConfigItem = { id: 's1', fields: {} };
    render(<SourceConfigItemCard {...baseProps({ source, trustOptions: TRUST_OPTIONS })} />);
    expect(screen.getByRole('combobox')).toHaveValue('');
  });

  it('renders a Refresh button only when capabilities.canRefresh is true, and calls onRefresh', async () => {
    const onRefresh = vi.fn();
    render(<SourceConfigItemCard {...baseProps({ onRefresh })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('omits the Refresh button when capabilities.canRefresh is false', () => {
    render(<SourceConfigItemCard {...baseProps({ capabilities: NO_CAPS })} />);
    expect(screen.queryByRole('button', { name: /Refresh/ })).toBeNull();
  });

  it('shows a Refreshing… label while refreshing and disables other actions', () => {
    render(<SourceConfigItemCard {...baseProps({ refreshing: true })} />);
    expect(screen.getByRole('button', { name: 'Refreshing…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeDisabled();
  });

  it('calls onRemove and shows a Removing… label while removing', () => {
    render(<SourceConfigItemCard {...baseProps({ removing: true })} />);
    expect(screen.getByRole('button', { name: 'Removing…' })).toBeDisabled();
  });

  it('calls onRemove when the remove button is clicked', async () => {
    const onRemove = vi.fn();
    render(<SourceConfigItemCard {...baseProps({ onRemove })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('renders the test control only when expanded and capabilities.canTest is true', async () => {
    render(<SourceConfigItemCard {...baseProps()} />);
    expect(screen.queryByRole('button', { name: 'Test' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'https://a.example' }));
    expect(screen.getByRole('button', { name: 'Test' })).toBeInTheDocument();
  });

  it('omits the test control entirely when capabilities.canTest is false, even when expanded', async () => {
    render(<SourceConfigItemCard {...baseProps({ capabilities: NO_CAPS })} />);
    await userEvent.click(screen.getByRole('button', { name: 'https://a.example' }));
    expect(screen.queryByRole('button', { name: 'Test' })).toBeNull();
  });

  it('calls onTest from the expanded test control', async () => {
    const onTest = vi.fn();
    render(<SourceConfigItemCard {...baseProps({ onTest })} />);
    await userEvent.click(screen.getByRole('button', { name: 'https://a.example' }));
    await userEvent.click(screen.getByRole('button', { name: 'Test' }));
    expect(onTest).toHaveBeenCalledTimes(1);
  });

  it('renders an empty masked value when the source is missing a field spec\'s key entirely', async () => {
    const source: SourceConfigItem = { id: 's1', fields: {} };
    const { container } = render(<SourceConfigItemCard {...baseProps({ source, fieldSpecs: [URL_FIELD] })} />);
    await userEvent.click(screen.getByRole('button', { name: 's1' }));
    const value = container.querySelector('.source-config-item-card-fields dd');
    expect(value?.textContent).toBe('');
  });

  it('passes the testResult through to the test control once expanded', async () => {
    render(<SourceConfigItemCard {...baseProps({ testResult: { ok: true, message: 'All good.' } })} />);
    await userEvent.click(screen.getByRole('button', { name: 'https://a.example' }));
    expect(screen.getByRole('status')).toHaveTextContent('All good.');
  });

  describe('enable/disable toggle (MCP-shaped enable/edit regression)', () => {
    it('renders an always-visible enabled checkbox when the source declares `enabled` and capabilities.canUpdate is true', () => {
      const source: SourceConfigItem = { id: 's1', fields: { url: 'https://a.example' }, enabled: true };
      render(<SourceConfigItemCard {...baseProps({ source })} />);
      const checkbox = screen.getByRole('checkbox', { name: /Enable/ });
      expect(checkbox).toBeChecked();
    });

    it('calls onUpdate with the new enabled value when toggled, without needing to expand first', async () => {
      const source: SourceConfigItem = { id: 's1', fields: { url: 'https://a.example' }, enabled: true };
      const onUpdate = vi.fn();
      render(<SourceConfigItemCard {...baseProps({ source, onUpdate })} />);
      await userEvent.click(screen.getByRole('checkbox', { name: /Enable/ }));
      expect(onUpdate).toHaveBeenCalledWith({ enabled: false });
    });

    it('omits the checkbox entirely when the source does not declare `enabled` at all', () => {
      render(<SourceConfigItemCard {...baseProps()} />);
      expect(screen.queryByRole('checkbox')).toBeNull();
    });

    it('omits the checkbox when capabilities.canUpdate is false, even if the source declares `enabled`', () => {
      const source: SourceConfigItem = { id: 's1', fields: { url: 'https://a.example' }, enabled: true };
      render(<SourceConfigItemCard {...baseProps({ source, capabilities: NO_CAPS })} />);
      expect(screen.queryByRole('checkbox')).toBeNull();
    });

    it('disables the checkbox while updating', () => {
      const source: SourceConfigItem = { id: 's1', fields: { url: 'https://a.example' }, enabled: true };
      render(<SourceConfigItemCard {...baseProps({ source, updating: true })} />);
      expect(screen.getByRole('checkbox', { name: /Enable/ })).toBeDisabled();
    });
  });

  describe('expand-to-edit (MCP-shaped enable/edit regression)', () => {
    it('does not render an Edit control when capabilities.canUpdate is false', async () => {
      render(<SourceConfigItemCard {...baseProps({ capabilities: NO_CAPS })} />);
      await userEvent.click(screen.getByRole('button', { name: 'https://a.example' }));
      expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    });

    it('switches the expanded field list from read-only to editable inputs seeded with current values, and saves a patch', async () => {
      const source: SourceConfigItem = { id: 's1', label: 'My server', fields: { url: 'https://a.example' } };
      const onUpdate = vi.fn();
      render(<SourceConfigItemCard {...baseProps({ source, onUpdate })} />);
      await userEvent.click(screen.getByRole('button', { name: 'My server' }));
      // Read-only before editing.
      expect(screen.getByText('https://a.example')).toBeInTheDocument();
      expect(screen.queryByRole('textbox', { name: /URL/ })).toBeNull();

      await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
      const urlInput = screen.getByLabelText('URL', { exact: false });
      expect(urlInput).toHaveValue('https://a.example');
      const labelInput = screen.getByLabelText('Label');
      expect(labelInput).toHaveValue('My server');

      await userEvent.clear(urlInput);
      await userEvent.type(urlInput, 'https://b.example');
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));

      expect(onUpdate).toHaveBeenCalledWith({ label: 'My server', fields: { url: 'https://b.example' } });
      // Editing mode closes after save.
      expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    });

    it('seeds an editable field with an empty string when the source is missing that field spec\'s key entirely', async () => {
      const source: SourceConfigItem = { id: 's1', fields: {} };
      render(<SourceConfigItemCard {...baseProps({ source, fieldSpecs: [URL_FIELD] })} />);
      await userEvent.click(screen.getByRole('button', { name: 's1' }));
      await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
      expect(screen.getByLabelText('URL', { exact: false })).toHaveValue('');
    });

    it('discards edits when Cancel is clicked, without calling onUpdate', async () => {
      const source: SourceConfigItem = { id: 's1', fields: { url: 'https://a.example' } };
      const onUpdate = vi.fn();
      render(<SourceConfigItemCard {...baseProps({ source, onUpdate })} />);
      await userEvent.click(screen.getByRole('button', { name: 'https://a.example' }));
      await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
      const urlInput = screen.getByLabelText('URL', { exact: false });
      await userEvent.clear(urlInput);
      await userEvent.type(urlInput, 'https://discarded.example');
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(onUpdate).not.toHaveBeenCalled();
      // Back to read-only, showing the ORIGINAL (unsaved edit discarded) value.
      const fieldValue = document.querySelector('.source-config-item-card-fields dd');
      expect(fieldValue?.textContent).toBe('https://a.example');
      expect(screen.queryByText('https://discarded.example')).toBeNull();
    });

    it('refuses to save an edit that fails the same validation the add form runs', async () => {
      // The audit finding: `validateSourceDraft`'s only non-test call site was
      // the ADD form, so the edit path pushed raw component state straight
      // through `port.updateSource`. A source created through a validated form
      // could then be edited into a shape that form would have rejected.
      const source: SourceConfigItem = { id: 's1', fields: { url: 'https://a.example' } };
      const onUpdate = vi.fn();
      render(<SourceConfigItemCard {...baseProps({ source, fieldSpecs: [{ ...URL_FIELD, required: true }], onUpdate })} />);
      await userEvent.click(screen.getByRole('button', { name: 'https://a.example' }));
      await userEvent.click(screen.getByRole('button', { name: 'Edit' }));

      const urlInput = screen.getByLabelText('URL', { exact: false });
      await userEvent.clear(urlInput);
      await userEvent.type(urlInput, 'http://169.254.169.254/latest/meta-data/');
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));

      expect(onUpdate).not.toHaveBeenCalled();
      // Still in edit mode, with the reason shown rather than a silent no-op.
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
      expect(screen.getByRole('alert').textContent).toMatch(/valid http/i);
    });

    it('refuses to save an edit that blanks a required field', async () => {
      const source: SourceConfigItem = { id: 's1', fields: { url: 'https://a.example' } };
      const onUpdate = vi.fn();
      render(<SourceConfigItemCard {...baseProps({ source, fieldSpecs: [{ ...URL_FIELD, required: true }], onUpdate })} />);
      await userEvent.click(screen.getByRole('button', { name: 'https://a.example' }));
      await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
      await userEvent.clear(screen.getByLabelText('URL', { exact: false }));
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));

      expect(onUpdate).not.toHaveBeenCalled();
      expect(screen.getByRole('alert').textContent).toMatch(/required/i);
    });

    it('shows no validation error until the operator actually tries to save', async () => {
      const source: SourceConfigItem = { id: 's1', fields: { url: 'https://a.example' } };
      render(<SourceConfigItemCard {...baseProps({ source, fieldSpecs: [{ ...URL_FIELD, required: true }] })} />);
      await userEvent.click(screen.getByRole('button', { name: 'https://a.example' }));
      await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
      await userEvent.clear(screen.getByLabelText('URL', { exact: false }));

      // Mid-edit an empty field is not yet a mistake — matching the add form's
      // `submitAttempted` behavior.
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('saves once the operator corrects the invalid value', async () => {
      const source: SourceConfigItem = { id: 's1', fields: { url: 'https://a.example' } };
      const onUpdate = vi.fn();
      render(<SourceConfigItemCard {...baseProps({ source, fieldSpecs: [{ ...URL_FIELD, required: true }], onUpdate })} />);
      await userEvent.click(screen.getByRole('button', { name: 'https://a.example' }));
      await userEvent.click(screen.getByRole('button', { name: 'Edit' }));

      const urlInput = screen.getByLabelText('URL', { exact: false });
      await userEvent.clear(urlInput);
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));
      expect(onUpdate).not.toHaveBeenCalled();

      await userEvent.type(urlInput, 'https://b.example');
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));

      expect(onUpdate).toHaveBeenCalledWith({ label: '', fields: { url: 'https://b.example' } });
      expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    });

    it('declares an explicit text color on the Edit/Save/Cancel toggle buttons, so a host page that resets bare <button> color to its own accent-ink cannot render them invisible', () => {
      // Regression: `.source-config-item-card-edit-toggle button` shipped with no `color` at all,
      // unlike its sibling rules (`.source-config-item-card-actions button, select` and
      // `.source-config-test-button`, both of which set `color: var(--jini-text)`). A host's own admin
      // design system has a global `button { ...; color: var(--primary-ink); }` base rule (an
      // off-white ink meant to sit on that rule's own colored `background`) that is MORE specific
      // than nothing, so it kept applying color even after this rule's `background` override took —
      // making Edit/Save/Cancel render as blank pills (off-white text on the light panel background)
      // while every other field on the same card, which DOES set its own color, rendered fine.
      expect(ruleBody('.source-config-item-card-edit-toggle button')).toMatch(/color:\s*var\(--jini-text\)/);
    });

    it('disables Save/Cancel while updating', async () => {
      const source: SourceConfigItem = { id: 's1', fields: { url: 'https://a.example' } };
      const { rerender } = render(<SourceConfigItemCard {...baseProps({ source })} />);
      await userEvent.click(screen.getByRole('button', { name: 'https://a.example' }));
      await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
      rerender(<SourceConfigItemCard {...baseProps({ source, updating: true })} />);
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    });
  });

  describe('i18n — trust badge/select and expanded field labels', () => {
    it('translates the trust badge (option label) under a matching dictionary', () => {
      const source: SourceConfigItem = { id: 's1', fields: {}, trust: 'trusted' };
      const { container } = render(
        <I18nProvider dictionaries={{ fr: { Trusted: 'Fiable' } }} initialLocale="fr">
          <SourceConfigItemCard {...baseProps({ source, trustOptions: TRUST_OPTIONS })} />
        </I18nProvider>,
      );
      expect(container.querySelector('.source-config-item-card-trust-badge')?.textContent).toBe('Fiable');
    });

    it('translates trust select option labels under a matching dictionary', () => {
      const source: SourceConfigItem = { id: 's1', fields: {}, trust: 'restricted' };
      render(
        <I18nProvider dictionaries={{ fr: { Restricted: 'Restreint', Trusted: 'Fiable' } }} initialLocale="fr">
          <SourceConfigItemCard {...baseProps({ source, trustOptions: TRUST_OPTIONS })} />
        </I18nProvider>,
      );
      expect(screen.getByDisplayValue('Restreint')).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Fiable' })).toBeInTheDocument();
    });

    it('translates expanded field labels under a matching dictionary', async () => {
      render(
        <I18nProvider dictionaries={{ fr: { URL: 'Adresse URL' } }} initialLocale="fr">
          <SourceConfigItemCard {...baseProps()} />
        </I18nProvider>,
      );
      await userEvent.click(screen.getByRole('button', { name: 'https://a.example' }));
      expect(screen.getByText('Adresse URL')).toBeInTheDocument();
    });
  });
});
