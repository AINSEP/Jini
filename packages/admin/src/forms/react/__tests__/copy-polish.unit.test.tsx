import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { FetchQueryProvider } from '@jini-ai/ui/fetch-query';
import type { ReactNode } from 'react';
import { createMemoryFormsApi } from '../../adapters/memory.js';
import type { AdminFormDefinition } from '../../models.js';
import { formAnswerColumns, formSubmissionRows } from '../../html-rules.js';
import { FormEditor } from '../pages/FormEditor.js';
import { FormsList } from '../pages/FormsList.js';
import { FormEditorHeaderText } from '../components/FormEditorHeaderText.js';
import { FormsPortsContext, FormsOptionsContext } from '../hooks/FormsPorts.hooks.js';

const form: AdminFormDefinition = {
  id: 'f1', name: 'Contact', slug: 'contact', status: 'active',
  fields: [{ id: 'full_name', label: 'Full name', type: 'text', required: true },
    { id: 'accepted', label: 'I agree', type: 'checkbox', required: false }],
  notify: { enabled: true, recipients: ['owner@example.com'] },
  createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
};

function renderForms(children: ReactNode, mode: 'builder' | 'html' = 'builder') {
  const api = createMemoryFormsApi({}, { forms: [{ ...form, mode }], submissions: [{
    id: 's1', formDefinitionId: 'f1', sourceIp: '127.0.0.1', submittedAt: '2026-10-02T00:00:00.000Z',
    data: { full_name: 'Sample Visitor', accepted: false, removed_field: 'Retained answer' },
  }] });
  return render(<FetchQueryProvider><FormsPortsContext.Provider value={{ formsApi: api, formsTrash: api.trash }}>
    <FormsOptionsContext.Provider value={{ locale: 'en' }}>{children}</FormsOptionsContext.Provider>
  </FormsPortsContext.Provider></FetchQueryProvider>);
}

describe('forms copy polish', () => {
  it.each(['builder', 'html'] as const)('carries %s field labels from the editor through the list into detail', async mode => {
    const user = userEvent.setup();
    renderForms(<FormEditor formId="contact" tab="submissions" />, mode);
    expect(await screen.findByRole('columnheader', { name: 'Full name' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'View' }));
    const name = await screen.findByText('Full name');
    expect(within(name.closest('tr')!).getByRole('cell')).toHaveTextContent('Sample Visitor');
    expect(within(screen.getByText('I agree').closest('tr')!).getByRole('cell')).toHaveTextContent('false');
    expect(within(screen.getByText('Unknown field').closest('tr')!).getByRole('cell')).toHaveTextContent('Retained answer');
    expect(screen.queryByText('full_name')).not.toBeInTheDocument();
    expect(screen.queryByText('removed_field')).not.toBeInTheDocument();
  });

  it('retains answers for missing or blank descriptors without exposing internal keys', () => {
    const columns = formAnswerColumns({ fields: [{ id: 'known', label: ' ', type: 'text', required: false }] });
    const data = JSON.parse('{"known":"","__proto__":false}') as Record<string, string | boolean>;
    expect(formSubmissionRows({ data, answerColumns: columns }, { unknownFieldLabel: 'Campo desconocido' })).toEqual([
      { key: 'known', label: 'Campo desconocido', value: '' },
      { key: '__proto__', label: 'Campo desconocido', value: 'false' },
    ]);
    expect(formSubmissionRows({ data: { missing: 'saved' }, answerColumns: [] })).toEqual([
      { key: 'missing', label: 'Unknown field', value: 'saved' },
    ]);
  });

  it('omits notification and recipient copy even for a form with stored recipients', async () => {
    renderForms(<FormsList />);
    await screen.findByRole('link', { name: 'Contact' });
    expect(screen.getAllByRole('columnheader').map(header => header.textContent)).toEqual([
      'Name', 'Slug', 'Created / Updated', 'Fields', 'More',
    ]);
    expect(screen.queryByText('1 recipient')).not.toBeInTheDocument();
  });

  it.each([
    [true, "Configure a new form's fields."],
    [false, "Configure this form's fields, or review its submissions."],
  ] as const)('describes only the available editor features (new=%s)', (isNew, subtitle) => {
    render(<FormEditorHeaderText isNew={isNew} name="Contact" t={key => key} />);
    expect(screen.getByText(subtitle)).toBeInTheDocument();
  });
});
