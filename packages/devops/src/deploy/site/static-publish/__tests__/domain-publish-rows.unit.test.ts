import { expect, test } from 'vitest';
import { domainPublishRows } from '../domain-publish-rows.js';

test('projects the deduplicated changes and provider summaries in confirmation order', () => {
  expect(domainPublishRows({ projectName: 'Studio', target: 'host', inspection: {
    resourceName: 'studio', targetId: 'host',
    hostingChanges: [{ reason: 'Create site' }, { zones: ['one', 'two'], active: true, prior: null }],
    domains: {
      inventoryStatus: 'complete', message: 'Ready',
      hostnames: [
        { hostname: 'studio.example.test', status: 'old-route', summary: 'Served by legacy' },
        { hostname: 'www.studio.example.test', status: 'not-bound', summary: ' ' },
        { hostname: 1, status: null },
      ],
      changes: [{ reason: 'Replace shared route once' }, { record: { type: 'CNAME', name: 'www' }, reason: ' ' }],
    },
    formSubmissions: { status: 'off', forms: 1, message: 'Forms are off', changes: [] },
  } })).toEqual([
    { label: 'Project', value: 'Studio' }, { label: 'Target', value: 'host' },
    { label: 'Hosting', value: 'Create site' }, { label: 'Hosting', value: 'zones: (one; two), active: true, prior: null' },
    { label: 'Now on studio.example.test', value: 'Served by legacy' },
    { label: 'Now on www.studio.example.test', value: 'not bound' },
    { label: 'Now on hostname', value: 'unknown' },
    { label: 'Will change', value: 'Replace shared route once' },
    { label: 'Will change', value: 'record: (type: CNAME, name: www), reason:  ' },
    { label: 'Form submissions', value: 'Forms are off' },
  ]);
});

test('explicitly reports no domain changes when a provider has no domain plan', () => {
  expect(domainPublishRows({ projectName: 'Studio', target: 'host', inspection: { resourceName: 'studio', targetId: 'host', hostingChanges: [] } }))
    .toEqual([{ label: 'Project', value: 'Studio' }, { label: 'Target', value: 'host' }, { label: 'Will change', value: 'No domain changes.' }]);
});
