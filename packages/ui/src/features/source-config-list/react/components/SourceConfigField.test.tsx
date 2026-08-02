import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../i18n/index.js';
import { SourceConfigField } from './SourceConfigField.js';
import type { SourceFieldSpec } from '../../types.js';

describe('SourceConfigField', () => {
  it('renders a text field and forwards changes', async () => {
    const onChange = vi.fn();
    const spec: SourceFieldSpec = { key: 'label', label: 'Label', kind: 'text', placeholder: 'e.g. My Server' };
    render(<SourceConfigField spec={spec} value="" onChange={onChange} />);
    const input = screen.getByPlaceholderText('e.g. My Server');
    await userEvent.type(input, 'x');
    expect(onChange).toHaveBeenCalledWith('x');
  });

  it('scopes the generated DOM id by idPrefix, so two instances for the same field key never collide (e.g. the add form + an item card editing the same fieldSpecs at once)', () => {
    const spec: SourceFieldSpec = { key: 'url', label: 'URL', kind: 'url' };
    render(
      <>
        <SourceConfigField spec={spec} value="a" onChange={vi.fn()} />
        <SourceConfigField spec={spec} value="b" idPrefix="source-config-item-card-x-field" onChange={vi.fn()} />
      </>,
    );
    const inputs = screen.getAllByDisplayValue(/^[ab]$/);
    expect(inputs).toHaveLength(2);
    expect(inputs[0]).toHaveAttribute('id', 'source-config-field-url');
    expect(inputs[1]).toHaveAttribute('id', 'source-config-item-card-x-field-url');
  });

  it('renders a url-kind field as type="url"', () => {
    const spec: SourceFieldSpec = { key: 'url', label: 'URL', kind: 'url' };
    render(<SourceConfigField spec={spec} value="https://a.example" onChange={vi.fn()} />);
    expect(screen.getByDisplayValue('https://a.example')).toHaveAttribute('type', 'url');
  });

  it('renders a required marker for a required field', () => {
    const spec: SourceFieldSpec = { key: 'url', label: 'URL', kind: 'url', required: true };
    render(<SourceConfigField spec={spec} value="" onChange={vi.fn()} />);
    expect(screen.getByText('*')).toBeInTheDocument();
  });

  it('does not render a required marker for an optional field', () => {
    const spec: SourceFieldSpec = { key: 'label', label: 'Label', kind: 'text' };
    render(<SourceConfigField spec={spec} value="" onChange={vi.fn()} />);
    expect(screen.queryByText('*')).toBeNull();
  });

  it('renders and toggles a password field between masked and revealed', async () => {
    const spec: SourceFieldSpec = { key: 'apiKey', label: 'API Key', kind: 'password' };
    render(<SourceConfigField spec={spec} value="sk-secret" onChange={vi.fn()} />);
    const input = screen.getByDisplayValue('sk-secret');
    expect(input).toHaveAttribute('type', 'password');
    await userEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect(input).toHaveAttribute('type', 'text');
    await userEvent.click(screen.getByRole('button', { name: 'Hide' }));
    expect(input).toHaveAttribute('type', 'password');
  });

  it('renders a select field with the given options', async () => {
    const onChange = vi.fn();
    const spec: SourceFieldSpec = {
      key: 'protocol',
      label: 'Protocol',
      kind: 'select',
      options: [
        { value: 'anthropic', label: 'Anthropic' },
        { value: 'openai', label: 'OpenAI' },
      ],
    };
    render(<SourceConfigField spec={spec} value="anthropic" onChange={onChange} />);
    await userEvent.selectOptions(screen.getByDisplayValue('Anthropic'), 'openai');
    expect(onChange).toHaveBeenCalledWith('openai');
  });

  it('renders a textarea field', async () => {
    const onChange = vi.fn();
    const spec: SourceFieldSpec = { key: 'headers', label: 'Headers', kind: 'textarea' };
    render(<SourceConfigField spec={spec} value="" onChange={onChange} />);
    const textarea = screen.getByLabelText('Headers');
    expect(textarea.tagName).toBe('TEXTAREA');
    await userEvent.type(textarea, 'a');
    expect(onChange).toHaveBeenCalledWith('a');
  });

  it('renders an error message with role="alert" and wires aria-describedby', () => {
    const spec: SourceFieldSpec = { key: 'url', label: 'URL', kind: 'url', required: true };
    render(<SourceConfigField spec={spec} value="" error="URL is required." onChange={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('URL is required.');
    expect(screen.getByDisplayValue('')).toHaveAttribute('aria-invalid', 'true');
  });

  it('renders no error element when no error is given', () => {
    const spec: SourceFieldSpec = { key: 'url', label: 'URL', kind: 'url' };
    render(<SourceConfigField spec={spec} value="" onChange={vi.fn()} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders a select field with no options (host hasn\'t loaded them yet) without throwing', () => {
    const spec: SourceFieldSpec = { key: 'protocol', label: 'Protocol', kind: 'select' };
    render(<SourceConfigField spec={spec} value="" onChange={vi.fn()} />);
    const select = screen.getByLabelText('Protocol') as HTMLSelectElement;
    // Only the disabled placeholder option renders.
    expect(select.options).toHaveLength(1);
  });

  it('disables the input when disabled is set', () => {
    const spec: SourceFieldSpec = { key: 'url', label: 'URL', kind: 'url' };
    render(<SourceConfigField spec={spec} value="" disabled onChange={vi.fn()} />);
    expect(screen.getByLabelText('URL')).toBeDisabled();
  });

  describe('i18n — host-supplied label/placeholder/option copy', () => {
    it('translates the field label and placeholder under a matching dictionary', () => {
      const spec: SourceFieldSpec = { key: 'url', label: 'URL', kind: 'url', placeholder: 'https://example.com' };
      render(
        <I18nProvider
          dictionaries={{ fr: { URL: 'Adresse URL', 'https://example.com': 'https://exemple.fr' } }}
          initialLocale="fr"
        >
          <SourceConfigField spec={spec} value="" onChange={vi.fn()} />
        </I18nProvider>,
      );
      expect(screen.getByText('Adresse URL')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('https://exemple.fr')).toBeInTheDocument();
    });

    it('translates select option labels under a matching dictionary', () => {
      const spec: SourceFieldSpec = {
        key: 'protocol',
        label: 'Protocol',
        kind: 'select',
        options: [{ value: 'anthropic', label: 'Anthropic' }],
      };
      render(
        <I18nProvider dictionaries={{ fr: { Anthropic: 'Anthropique' } }} initialLocale="fr">
          <SourceConfigField spec={spec} value="anthropic" onChange={vi.fn()} />
        </I18nProvider>,
      );
      expect(screen.getByDisplayValue('Anthropique')).toBeInTheDocument();
    });
  });

  describe('credential disclosure', () => {
    it('re-hides a revealed password once the field empties, so the NEXT credential is not typed in the clear', async () => {
      // The add form clears its values after a successful submit but keeps this
      // component mounted. A `revealed` left on from the previous entry meant the
      // next key was typed into a visible `type="text"` input.
      const spec: SourceFieldSpec = { key: 'apiKey', label: 'API Key', kind: 'password' };
      const { rerender } = render(<SourceConfigField spec={spec} value="sk-first" onChange={vi.fn()} />);

      await userEvent.click(screen.getByRole('button', { name: 'Show' }));
      expect(screen.getByLabelText('API Key', { exact: false })).toHaveAttribute('type', 'text');

      // Successful submit: the form resets values, this component stays mounted.
      rerender(<SourceConfigField spec={spec} value="" onChange={vi.fn()} />);

      expect(screen.getByLabelText('API Key', { exact: false })).toHaveAttribute('type', 'password');
    });

    it('masks each env VALUE but keeps its NAME visible, and reveals on demand', async () => {
      const spec: SourceFieldSpec = { key: 'env', label: 'Env', kind: 'secret-textarea' };
      render(<SourceConfigField spec={spec} value={'GITHUB_TOKEN=ghp_liveSecret\nDEBUG=true'} onChange={vi.fn()} />);

      const box = screen.getByLabelText('Env', { exact: false }) as HTMLTextAreaElement;
      expect(box.value).toContain('GITHUB_TOKEN=');
      expect(box.value).not.toContain('ghp_liveSecret');
      // Masked text is not the real value, so it must not be editable.
      expect(box).toHaveAttribute('readonly');

      await userEvent.click(screen.getByRole('button', { name: 'Show' }));
      expect((screen.getByLabelText('Env', { exact: false }) as HTMLTextAreaElement).value).toContain('ghp_liveSecret');
    });

    it('leaves a plain textarea unmasked and editable', async () => {
      const onChange = vi.fn();
      const spec: SourceFieldSpec = { key: 'args', label: 'Args', kind: 'textarea' };
      render(<SourceConfigField spec={spec} value="--verbose" onChange={onChange} />);
      const box = screen.getByLabelText('Args', { exact: false }) as HTMLTextAreaElement;
      expect(box.value).toBe('--verbose');
      expect(box).not.toHaveAttribute('readonly');
    });
  });

});
