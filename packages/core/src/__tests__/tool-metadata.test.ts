import { describe, expect, it } from 'vitest';
import { buildDomainRegistrations, projectToolMetadata, toolMetadataFor, withToolMetadata, type ToolRegistration, type AgentToolDefinition, type ToolApprovalMetadata } from '../index.js';

/** Phase 16: registration declarations generate projections without weakening independent risk. */
describe('domain tool metadata', () => {
  const declared = {
    search: { keywords: 'notes edit', queries: ['Edit my note.'] },
    approval: { class: 'edit', confirmation: 'direct' },
  } as const;
  const registration: ToolRegistration = {
    descriptor: { id: 'notes_update', readOnly: false },
    handler: async () => ({ changed: true }), policy: { authorize: () => 'allow' },
  };

  it('projects absent, direct, input-dependent, plan, secret and callback facts independently', () => {
    const result = projectToolMetadata<ToolApprovalMetadata>({ domains: [{ domain: 'notes', tools: {
      notes_update: declared,
      notes_publish: { approval: { class: 'publish', confirmation: 'policy' } },
      notes_replace: { approval: { class: 'restore-over-existing', confirmation: 'plan' } },
      notes_create: { approval: { class: 'edit', confirmation: 'direct', rule: 'create-status' } },
      secret_save: { mcpUi: { secretField: { secret: true } } },
      pick_choice: { mcpUi: { redeemable: true } },
      legacy_delete: { mcpUi: { exchangeOnly: true, redeemable: true } },
      no_projection: {},
    } }] });
    expect(result.keywords).toEqual({ notes_update: 'notes edit' });
    expect(result.queries).toEqual({ notes_update: ['Edit my note.'] });
    expect([...result.policyConfirmationIds]).toEqual(['notes_publish', 'notes_replace', 'notes_create']);
    expect([...result.secretFormIds]).toEqual(['secret_save']);
    expect(result.secretForms).toEqual({ secret_save: { secretField: { secret: true } } });
    expect([...result.redeemableIds].sort()).toEqual(['legacy_delete', 'notes_create', 'notes_publish', 'notes_replace', 'pick_choice', 'secret_save']);
    expect([...result.exchangeOnlyIds].sort()).toEqual(['legacy_delete', 'notes_create', 'notes_publish', 'notes_replace', 'secret_save']);
    expect(result.approvals.notes_update).toEqual(declared.approval);
    expect(Object.keys(result.byId)).toHaveLength(8);
    expect(projectToolMetadata({ domains: [] }).redeemableIds.size).toBe(0);
  });

  it('refuses duplicate ownership even when declarations agree', () => {
    expect(() => projectToolMetadata({ domains: [
      { domain: 'first', tools: { notes_update: declared } },
      { domain: 'second', tools: { notes_update: declared } },
    ] })).toThrow("tool-metadata: 'notes_update' is declared by both first and second");
  });

  it('never treats inherited keys as registered metadata', () => {
    expect(toolMetadataFor({ toolId: 'constructor', metadata: {} })).toBeUndefined();
    expect(toolMetadataFor({ toolId: 'notes_update', metadata: undefined })).toBeUndefined();
    const inherited = Object.create({ notes_update: declared });
    expect(withToolMetadata({ registrations: [registration], metadata: inherited })[0]).toBe(registration);
    expect(toolMetadataFor({ toolId: '__proto__', metadata: JSON.parse('{"__proto__":{"approval":{"class":"delete","confirmation":"plan"}}}') })?.approval?.class).toBe('delete');
  });

  it('binds host metadata without changing handler, authorization, risk or the input', () => {
    const bound = withToolMetadata({ registrations: [registration], metadata: { notes_update: declared } })[0]!;
    expect(bound.descriptor.metadata).toBe(declared);
    expect(bound.handler).toBe(registration.handler);
    expect(bound.policy).toBe(registration.policy);
    expect(bound.descriptor.readOnly).toBe(false);
    expect(registration.descriptor.metadata).toBeUndefined();
    expect(withToolMetadata({ registrations: [bound], metadata: { notes_update: {} } })[0]).toBe(bound);
  });

  it('propagates catalog or domain metadata after independently checking risk', () => {
    const entry: AgentToolDefinition = { name: 'notes_update', description: 'Update a note',
      sideEffects: 'mutates-durable-state', authorization: { permission: 'notes.edit' }, inputSchema: { type: 'object' } };
    const spec = { domain: 'notes', catalogModule: 'notes/catalog', catalog: new Map([[entry.name, entry]]),
      handlers: { notes_update: registration.handler }, derivedRisk: new Map([['notes_update', 'mutates-durable-state' as const]]), metadata: { notes_update: declared } };
    expect(buildDomainRegistrations(spec)[0]!.descriptor.metadata).toBe(declared);
    expect(() => buildDomainRegistrations({ ...spec, catalog: new Map([[entry.name, { ...entry, sideEffects: 'none' as const }]]) }))
      .toThrow("'notes_update' declares sideEffects 'none' but this layer derives 'mutates-durable-state'");
    expect(() => buildDomainRegistrations({ ...spec, derivedRisk: new Map() })).toThrow("'notes_update' has no entry in DERIVED_RISK_BY_TOOL_ID");
    const catalogMetadata = { approval: { class: 'publish', confirmation: 'policy' } } as const;
    expect(buildDomainRegistrations({ ...spec, catalog: new Map([[entry.name, { ...entry, metadata: catalogMetadata }]]) })[0]!.descriptor.metadata).toBe(catalogMetadata);
    const { metadata: _hostMetadata, ...withoutMetadata } = spec;
    expect(buildDomainRegistrations(withoutMetadata)[0]!.descriptor.metadata).toBeUndefined();
  });
});
