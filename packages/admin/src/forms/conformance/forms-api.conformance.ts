import type { AdminFormsPort } from '../../core/ports/forms.js';
export interface FormsConformanceResult { readonly passed: number; readonly failures: readonly string[]; }
/** Run on an isolated API: creates definitions and trashes seeded submissions.
 * The host provides a disposable seed so conformance never touches an operator's live data. */
export async function runFormsApiConformance(
  { api }: { api: AdminFormsPort },
  { slug = 'forms-conformance', submission }: { slug?: string; submission?: { formId: string; submissionId: string } } = {},
): Promise<FormsConformanceResult> {
  const failures: string[] = [];
  let passed = 0;
  const check = (name: string, accepted: boolean) => { if (accepted) passed++; else failures.push(name); };
  const field = { id: 'email', label: 'Email', type: 'email', required: true, className: 'wide', attributes: { 'aria-label': 'Email' } };
  const created = await api.createFormDefinition({ name: 'Contact', slug, fields: [field] }, { notify: { enabled: true, recipients: ['owner@example.com'] } });
  check('create returns requested definition', created.name === 'Contact' && created.slug === slug && created.status === 'active');
  check('field attributes survive create', created.fields[0]?.className === 'wide' && created.fields[0]?.attributes?.['aria-label'] === 'Email');
  check('list includes created definition', (await api.listFormDefinitions({})).some(form => form.id === created.id));
  check('get returns created id', (await api.getFormDefinition({ id: created.id })).id === created.id);
  const snapshot = await api.getFormDefinition({ id: created.id });
  Object.assign(snapshot.fields[0]!, { label: 'Changed only in the read snapshot' });
  check('read snapshots cannot mutate stored fields', (await api.getFormDefinition({ id: created.id })).fields[0]?.label === 'Email');
  const updated = await api.updateFormDefinition({ id: created.id }, { name: 'Renamed', fields: [...created.fields, { id: 'message', label: 'Message', type: 'textarea', required: false }] });
  check('name patch and added field persist', updated.name === 'Renamed' && updated.fields.length === 2);
  check('untouched notify survives update', updated.notify.enabled && updated.notify.recipients[0] === 'owner@example.com');
  let refused = false;
  try { await api.updateFormDefinition({ id: created.id }, { fields: [] }); } catch { refused = true; }
  check('existing fields cannot be removed', refused);
  check('rejected removal leaves fields intact', (await api.getFormDefinition({ id: created.id })).fields.length === 2);
  const disabled = await api.updateFormDefinition({ id: created.id }, { status: 'disabled' });
  check('definition disable is reversible', disabled.status === 'disabled' && (await api.updateFormDefinition({ id: created.id }, { status: 'active' })).status === 'active');
  const html = await api.updateFormDefinition({ id: created.id }, { mode: 'html', html: '<input name="email">' });
  check('HTML authoring survives update', html.mode === 'html' && html.html === '<input name="email">');
  check('builder switch is explicit', (await api.updateFormDefinition({ id: created.id }, { mode: 'builder' })).mode === 'builder');
  check('empty submission page has null cursor', (await api.listFormSubmissions({ formId: created.id })).nextCursor === null);
  check('definition has no delete operation', !('deleteFormDefinition' in api));
  if (submission) {
    const page = await api.listFormSubmissions({ formId: submission.formId }, { limit: 1 });
    check('submission page is form scoped', page.items.every(item => item.formDefinitionId === submission.formId));
    check('submission detail is scoped', (await api.getFormSubmission(submission)).formDefinitionId === submission.formId);
    let wrongFormRejected = false;
    try { await api.getFormSubmission({ formId: created.id, submissionId: submission.submissionId }); } catch { wrongFormRejected = true; }
    check('a submission of another form is unavailable', wrongFormRejected);
    let wrongFormDeleteRejected = false;
    try { await api.deleteFormSubmission({ formId: created.id, submissionId: submission.submissionId }); } catch { wrongFormDeleteRejected = true; }
    check('cross-form trash is rejected without removing the submission', wrongFormDeleteRejected && (await api.getFormSubmission(submission)).id === submission.submissionId);
    await api.deleteFormSubmission(submission);
    let missing = false;
    try { await api.getFormSubmission(submission); } catch { missing = true; }
    check('trashed submission detail is unavailable', missing);
    check('trashed submission is absent from active pages', !(await api.listFormSubmissions({ formId: submission.formId })).items.some(item => item.id === submission.submissionId));
  }
  return { passed, failures };
}
