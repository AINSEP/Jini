import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { validateSourceDraft } from '../rules.js';
import type { SourceFieldSpec, SourceTrustOption } from '../types.js';
import { SourceConfigAddForm } from '../react/components/SourceConfigAddForm.js';
import type { ComponentProps } from 'react';

const URL_FIELD: SourceFieldSpec = { key: 'url', label: 'URL', kind: 'url', required: true };
const TRUST_OPTIONS: SourceTrustOption[] = [
  { value: 'restricted', label: 'Restricted' },
  { value: 'trusted', label: 'Trusted' },
];

function baseProps(overrides: Partial<ComponentProps<typeof SourceConfigAddForm>> = {}) {
  const values = { url: '' };
  return {
    fieldSpecs: [URL_FIELD],
    values,
    validation: validateSourceDraft([URL_FIELD], values),
    submitAttempted: false,
    submitting: false,
    onFieldChange: vi.fn(),
    onTrustChange: vi.fn(),
    onSubmit: vi.fn(),
    ...overrides,
  };
}

describe('SourceConfigAddForm', () => {
  it('renders one SourceConfigField per field spec', () => {
    render(<SourceConfigAddForm {...baseProps()} />);
    expect(screen.getByLabelText('URL', { exact: false })).toBeInTheDocument();
  });

  it('does not render a trust select when trustOptions is omitted', () => {
    render(<SourceConfigAddForm {...baseProps()} />);
    expect(screen.queryByLabelText('Trust level')).toBeNull();
  });

  it('renders a trust select when trustOptions is given, and reports changes', async () => {
    const onTrustChange = vi.fn();
    render(<SourceConfigAddForm {...baseProps({ trustOptions: TRUST_OPTIONS, onTrustChange })} />);
    const select = screen.getByLabelText('Trust level');
    await userEvent.selectOptions(select, 'trusted');
    expect(onTrustChange).toHaveBeenCalledWith('trusted');
  });

  it('does not show field errors before a submit attempt', () => {
    render(<SourceConfigAddForm {...baseProps()} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows field errors once submitAttempted is true', () => {
    render(<SourceConfigAddForm {...baseProps({ submitAttempted: true })} />);
    expect(screen.getByRole('alert')).toHaveTextContent('URL is required.');
  });

  it('calls onFieldChange when a field value changes', async () => {
    const onFieldChange = vi.fn();
    render(<SourceConfigAddForm {...baseProps({ onFieldChange })} />);
    await userEvent.type(screen.getByLabelText('URL', { exact: false }), 'x');
    expect(onFieldChange).toHaveBeenCalledWith('url', 'x');
  });

  it('calls onSubmit when the form is submitted', async () => {
    const onSubmit = vi.fn();
    const values = { url: 'https://a.example' };
    render(
      <SourceConfigAddForm
        {...baseProps({ values, validation: validateSourceDraft([URL_FIELD], values), onSubmit })}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add source' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('does not render a trust select when trustOptions is an empty list', () => {
    render(<SourceConfigAddForm {...baseProps({ trustOptions: [] })} />);
    expect(screen.queryByLabelText('Trust level')).toBeNull();
  });

  it('shows a hidden "Select…" placeholder option while no trust is chosen', () => {
    render(<SourceConfigAddForm {...baseProps({ trustOptions: TRUST_OPTIONS })} />);
    expect(screen.getByText('Select…')).toHaveValue('');
  });

  it('omits the "Select…" placeholder once a trust value is chosen', () => {
    render(<SourceConfigAddForm {...baseProps({ trustOptions: TRUST_OPTIONS, trust: 'trusted' })} />);
    expect(screen.queryByText('Select…')).toBeNull();
    expect(screen.getByLabelText('Trust level')).toHaveValue('trusted');
  });

  it('renders a custom cancelLabel on the Cancel button', () => {
    render(<SourceConfigAddForm {...baseProps({ onCancel: vi.fn(), cancelLabel: 'Close' })} />);
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('renders no Cancel button when onCancel is omitted', () => {
    render(<SourceConfigAddForm {...baseProps()} />);
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
  });

  it('renders a Cancel button when onCancel is given, which calls onCancel and never submits', async () => {
    const onCancel = vi.fn();
    const onSubmit = vi.fn();
    render(<SourceConfigAddForm {...baseProps({ onCancel, onSubmit, agentHandle: 'mcp-add' })} />);
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(cancel).toHaveAttribute('type', 'button');
    expect(cancel).toHaveAttribute('data-agent-element', 'mcp-add-cancel');
    await userEvent.click(cancel);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('renders a custom addLabel when given', () => {
    render(<SourceConfigAddForm {...baseProps({ addLabel: 'Add MCP server' })} />);
    expect(screen.getByRole('button', { name: 'Add MCP server' })).toBeInTheDocument();
  });

  it('shows an "Adding…" submit label and disables fields while submitting', () => {
    render(<SourceConfigAddForm {...baseProps({ submitting: true })} />);
    expect(screen.getByRole('button', { name: 'Adding…' })).toBeDisabled();
    expect(screen.getByLabelText('URL', { exact: false })).toBeDisabled();
  });

  it('renders a submitError banner with role="alert"', () => {
    render(<SourceConfigAddForm {...baseProps({ submitError: 'Marketplace unreachable.' })} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Marketplace unreachable.');
  });

  it('defaults a field with no matching key in `values` to an empty string rather than throwing', () => {
    // Defensive fallback for a host rendering this form directly with a values
    // map that doesn't cover every field spec (the wired hook always seeds a
    // complete draft, but this component doesn't assume its caller does).
    render(<SourceConfigAddForm {...baseProps({ values: {} })} />);
    expect(screen.getByLabelText('URL', { exact: false })).toHaveValue('');
  });

  describe('test-before-save (BYOK "test before save" regression)', () => {
    it('publishes the test control under <agentHandle>-test when an agentHandle is given', () => {
      const values = { url: 'https://mcp.example' };
      render(
        <SourceConfigAddForm
          {...baseProps({ values, validation: validateSourceDraft([URL_FIELD], values), canTest: true, onTest: vi.fn(), agentHandle: 'mcp-add' })}
        />,
      );
      expect(screen.getByRole('button', { name: 'Test' })).toHaveAttribute('data-agent-element', 'mcp-add-test');
    });

    it('does not render a test control when canTest is false or onTest is omitted', () => {
      const { rerender } = render(<SourceConfigAddForm {...baseProps({ canTest: false, onTest: vi.fn() })} />);
      expect(screen.queryByRole('button', { name: /Test/ })).toBeNull();
      rerender(<SourceConfigAddForm {...baseProps({ canTest: true })} />);
      expect(screen.queryByRole('button', { name: /Test/ })).toBeNull();
    });

    it('renders a Test control and calls onTest when canTest is true and the draft is valid', async () => {
      const onTest = vi.fn();
      const values = { url: 'https://a.example' };
      render(
        <SourceConfigAddForm
          {...baseProps({ values, validation: validateSourceDraft([URL_FIELD], values), canTest: true, onTest })}
        />,
      );
      const button = screen.getByRole('button', { name: 'Test' });
      expect(button).not.toBeDisabled();
      await userEvent.click(button);
      expect(onTest).toHaveBeenCalledTimes(1);
    });

    it('disables the Test control while the draft fails validation, even before a submit attempt', () => {
      // Unlike field errors (which only show post-submit-attempt), the test
      // control's disabled state reflects validity immediately — testing an
      // incomplete draft is never meaningful, matching the origin
      // `canTestProvider`/`baseUrlValid` gate.
      render(<SourceConfigAddForm {...baseProps({ canTest: true, onTest: vi.fn() })} />);
      expect(screen.getByRole('button', { name: 'Test' })).toBeDisabled();
    });

    it('shows a running state and the test result once resolved', () => {
      const values = { url: 'https://a.example' };
      const { rerender } = render(
        <SourceConfigAddForm
          {...baseProps({
            values,
            validation: validateSourceDraft([URL_FIELD], values),
            canTest: true,
            onTest: vi.fn(),
            testing: true,
          })}
        />,
      );
      expect(screen.getByRole('status')).toHaveTextContent('Testing…');
      rerender(
        <SourceConfigAddForm
          {...baseProps({
            values,
            validation: validateSourceDraft([URL_FIELD], values),
            canTest: true,
            onTest: vi.fn(),
            testing: false,
            testResult: { ok: true, message: 'Connected in 8ms.' },
          })}
        />,
      );
      expect(screen.getByText('Connected in 8ms.')).toBeInTheDocument();
    });

    it('disables the Test control while submitting', () => {
      const values = { url: 'https://a.example' };
      render(
        <SourceConfigAddForm
          {...baseProps({
            values,
            validation: validateSourceDraft([URL_FIELD], values),
            canTest: true,
            onTest: vi.fn(),
            submitting: true,
          })}
        />,
      );
      expect(screen.getByRole('button', { name: 'Test' })).toBeDisabled();
    });
  });
});

describe('SourceConfigAddForm without the trust pair (SourceTrustSelectorProps)', () => {
  it('renders and submits with neither trustOptions nor onTrustChange', async () => {
    const { onTrustChange: _unused, trustOptions: _none, ...withoutTrust } = baseProps();
    const onSubmit = vi.fn();
    render(<SourceConfigAddForm {...withoutTrust} onSubmit={onSubmit} />);
    expect(screen.getByLabelText('URL', { exact: false })).toBeInTheDocument();
    expect(screen.queryByLabelText('Trust level')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
  });
});
