import { webcrypto } from "node:crypto";
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'vitest';
import { canonicalJson } from '@jini-ai/core/records';
import { captureSubmissionEvidence, readSubmissionEvidence, submissionEvidenceSchema } from '../submission-evidence.js';
import { toSubmissionRecord, toSubmissionRow } from '../sql/repo.rows.js';
import type { FormDefinitionRecord, FormSubmissionRecord } from '../types.js';

const definition: FormDefinitionRecord & { html?: string } = {
  id:'f', workspaceId:'w', name:'Consent', slug:'consent', fields:[
    {id:'choice',label:'Original choice',type:'select',required:true,options:[{value:'a',label:'Original option'}]},
    {id:'accept',label:'I agree to the original terms',helpText:'Original privacy notice',type:'checkbox',required:true},
  ], notify:{enabled:false,recipients:[]},status:'active',version:1,createdAt:'now',updatedAt:'now',html:'<p>Exact original privacy wording.</p>',
};

test('captures immutable labels, options and exact consent before definitions change', async () => {
  const source = structuredClone(definition);
  const evidence = await captureSubmissionEvidence({crypto:webcrypto,definition:source,capturedAt:'2026-11-05T18:00:00.000Z',source:'native'});
  const schema = submissionEvidenceSchema({definition});
  assert.equal(evidence.schemaHash, createHash('sha256').update(canonicalJson({value:schema})).digest('hex'));
  source.fields[0]!.label='Changed'; source.fields[0]!.options![0]!.label='Changed'; source.fields[1]!.label='Changed consent'; source.html='New prose';
  assert.equal(evidence.fields[0]!.label,'Original choice');
  assert.equal(evidence.fields[0]!.options![0]!.label,'Original option');
  assert.deepEqual(evidence.consent,[{fieldId:'accept',wording:'I agree to the original terms',helpText:'Original privacy notice'}]);
  assert.equal(evidence.html,definition.html);
  assert.notEqual((await captureSubmissionEvidence({crypto:webcrypto,definition:source,capturedAt:'later',source:'native'})).schemaHash,evidence.schemaHash);
});

test('SQL envelope retains captured evidence separately from colliding visitor field names', async () => {
  const evidence=await captureSubmissionEvidence({crypto:webcrypto,definition,capturedAt:'now',source:'cloudflare'});
  const record:FormSubmissionRecord={id:'s',workspaceId:'w',formDefinitionId:'f',data:{evidence:'visitor evidence',validation:'visitor validation'},sourceIp:null,submittedAt:'now',evidence};
  const row=toSubmissionRow(record);
  const decoded=toSubmissionRecord({...row,version:1,deleted_at:null} as never);
  assert.deepEqual(decoded.evidence,evidence); assert.deepEqual(decoded.data,record.data);
});

test('legacy answer rows and prior invalid envelope remain evidence unavailable', () => {
  for(const json of [JSON.stringify({evidence:'answer'}),JSON.stringify(['@jini/form-submission/v1',{answer:'x'},{status:'invalid',fieldErrors:[]}])]) {
    const decoded=toSubmissionRecord({id:'s',workspace_id:'w',form_definition_id:'f',data_json:json,source_ip:null,submitted_at:'now',version:1,deleted_at:null});
    assert.equal(decoded.evidence,undefined);
  }
});

test('refuses malformed or oversized remote evidence rather than inventing history', () => {
  assert.equal(readSubmissionEvidence({value:undefined}),undefined);
  assert.throws(()=>readSubmissionEvidence({value:{version:1,fields:'forged'}}),/evidence/i);
  assert.throws(()=>readSubmissionEvidence({value:{...submissionEvidenceSchema({definition}),version:1,schemaHash:'a'.repeat(64),capturedAt:'now',source:'cloudflare',html:'x'.repeat(1024*1024)}}),/evidence/i);
});

test('remote evidence refuses each malformed header, field, option and consent independently', () => {
  const header = { version: 1, schemaHash: 'b'.repeat(64), capturedAt: '2026-11-20T12:00:00.000Z', source: 'cloudflare' };
  const field = { id: 'shift', label: 'Shift', type: 'select', required: true, options: [{ value: 'am', label: 'Morning' }] };
  const consent = { fieldId: 'check', wording: 'I agree', helpText: 'Privacy notice' };
  const valid = { ...header, html: '<p>Privacy notice</p>', fields: [field], consent: [consent] };
  assert.equal(readSubmissionEvidence({ value: null }), undefined);
  assert.deepEqual(readSubmissionEvidence({ value: valid }), valid);
  for (const value of [true, 'history', 2, []]) {
    assert.throws(() => readSubmissionEvidence({ value }), new TypeError('Invalid form submission evidence.'));
  }
  const cases: Array<[object, string]> = [
    [{ version: 2 }, 'hash'], [{ schemaHash: 64 }, 'hash'], [{ schemaHash: 'B'.repeat(64) }, 'hash'],
    [{ capturedAt: null }, 'provenance'], [{ source: 'unknown' }, 'provenance'],
    [{ html: [] }, 'HTML'], [{ fields: {} }, 'fields'],
    [{ fields: [field, undefined] }, 'fields'],
    ...[ { id: null }, { label: null }, { type: null }, { required: 'true' }, { options: {} },
      { options: [null] }, { options: [{ value: 1, label: 'Morning' }] }, { options: [{ value: 'am', label: 1 }] },
    ].map((patch): [object, string] => [{ fields: [field, { ...field, ...patch }] }, 'fields']),
    [{ consent: {} }, 'consent'], [{ consent: [consent, null] }, 'consent'],
    ...[{ fieldId: null }, { wording: 1 }, { helpText: [] }].map((patch): [object, string] => [
      { consent: [consent, { ...consent, ...patch }] }, 'consent',
    ]),
  ];
  for (const [patch, reason] of cases) {
    assert.throws(() => readSubmissionEvidence({ value: { ...valid, ...patch } }), new TypeError(`Invalid form submission evidence ${reason}.`), JSON.stringify(patch));
  }
  const decoded = readSubmissionEvidence({ value: valid })!;
  valid.fields[0]!.options[0]!.label = 'Edited label';
  assert.equal(decoded.fields[0]?.options?.[0]?.label, 'Morning');
});

test('a list with an allowed provenance label is not itself a valid provenance value', () => {
  const evidence = { version: 1, schemaHash: 'a'.repeat(64), capturedAt: '2026-11-20T12:00:00.000Z',
    fields: [], consent: [], source: ['cloudflare'] };
  assert.throws(() => readSubmissionEvidence({ value: evidence }), new TypeError('Invalid form submission evidence provenance.'));
});
