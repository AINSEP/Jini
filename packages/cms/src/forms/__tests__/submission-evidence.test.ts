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
  const evidence = await captureSubmissionEvidence({definition:source,capturedAt:'2026-11-05T18:00:00.000Z',source:'native'});
  const schema = submissionEvidenceSchema({definition});
  assert.equal(evidence.schemaHash, createHash('sha256').update(canonicalJson({value:schema})).digest('hex'));
  source.fields[0]!.label='Changed'; source.fields[0]!.options![0]!.label='Changed'; source.fields[1]!.label='Changed consent'; source.html='New prose';
  assert.equal(evidence.fields[0]!.label,'Original choice');
  assert.equal(evidence.fields[0]!.options![0]!.label,'Original option');
  assert.deepEqual(evidence.consent,[{fieldId:'accept',wording:'I agree to the original terms',helpText:'Original privacy notice'}]);
  assert.equal(evidence.html,definition.html);
  assert.notEqual((await captureSubmissionEvidence({definition:source,capturedAt:'later',source:'native'})).schemaHash,evidence.schemaHash);
});

test('SQL envelope retains captured evidence separately from colliding visitor field names', async () => {
  const evidence=await captureSubmissionEvidence({definition,capturedAt:'now',source:'cloudflare'});
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
