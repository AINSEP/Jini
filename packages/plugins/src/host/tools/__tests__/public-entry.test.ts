import { expect, test } from 'vitest';
import { createApprovalHandler, type ToolExecutionContext, type AgentToolDefinition } from '@jini-ai/core';
import { buildPluginManagementRegistrations, buildPluginInstallRegistrations, buildPluginSourceRegistrations, type PluginManagementToolsRequired, type PluginApprovalPort } from '@jini-ai/plugins/host/tools';
import { PluginInstallError } from '@jini-ai/plugins/host/node';

const ids = { list: 'foreign_inventory', setEnabled: 'foreign_switch', uninstall: 'foreign_remove' };
const ctx = (input: unknown): ToolExecutionContext => ({ executionId: 'foreign-call', principal: { id: 'foreign-human' }, run: { id: 'foreign-run' }, signal: new AbortController().signal, input });
const approvals: PluginApprovalPort<string> = {
  handler: (steps, options) => createApprovalHandler({
    prepare: steps.prepare,
    describe: async ({ ctx, prepared }) => ({ ask: options?.ask?.({ prepared }) ?? true, description: await steps.describe({ ctx, prepared }) }),
    askHuman: async () => ({ confirmed: true }),
    run: ({ ctx, prepared, confirmer, choice }, execution) => steps.run({ ctx, prepared, confirmer, ...(choice === undefined ? {} : { choice }) }, execution),
    notConfirmed: () => ({ cancelled: false, note: 'foreign no answer' }),
  }),
  notConfirmed: () => ({ cancelled: false, note: 'foreign no answer' }),
};
function catalog(): AgentToolDefinition[] {
  return Object.values(ids).map((name, index) => ({ name, description: 'Foreign host copy', sideEffects: index === 0 ? 'none' : index === 1 ? 'mutates-durable-state' : 'deletes-durable-state', authorization: { permission: index === 0 ? 'foreign.read' : 'foreign.write' }, inputSchema: { type: 'object' } }));
}
function fixture() {
  const calls: unknown[] = [];
  const required: PluginManagementToolsRequired<string> = {
    registration: { domain: 'foreign.domain', catalogModule: 'foreign/catalog', catalog: catalog(), metadata: {} },
    workspaceId: 'foreign-space', authorize: async input => { calls.push(input); return { allowed: true, reason: 'foreign-grant' }; },
    permissions: { read: 'foreign.read', enable: 'foreign.write' }, toolIds: ids,
    entityTypes: { plugin: 'foreign-package', agentPlugin: 'foreign-guidance', activation: 'foreign-activation' }, actorPluginId: 'foreign-agent', clock: { nowMs: () => 0 },
    pluginActivationRepo: { getActivation: async () => null, save: async row => { calls.push(row); }, deleteActivation: async () => {}, listAll: async () => [] },
    discoverPlugins: async () => [{ id: 'package', name: 'Package', version: '1.0.0', source: 'site', status: 'valid', errors: [] }],
    removePlugin: async () => ({ ok: true, version: null }), onPluginEnabled: async () => {}, onPluginDisabled: () => {},
    agentPlugins: {
      listInstalled: async () => [{ pluginId: 'guidance', archiveDigest: 'foreign-digest', skills: [{ name: 'guide' }] }],
      assertWritable: async () => {}, setEnabled: async input => ({ pluginId: input.pluginId, enabled: input.enabled }), provisionMcp: async () => {}, uninstall: async () => ({ removed: 'foreign-owner' }),
      searchCandidate: ({ candidate }) => ({ pluginId: candidate.pluginId, enabled: false, description: 'foreign OFF' }), compatibility: () => undefined, classifyError: () => undefined,
    },
    providerFaces: { linkedProvider: async () => undefined, describeLinkedFace: () => ({ code: 'foreign-link', message: 'foreign link', providerPluginId: 'foreign-provider' }), describeLinkedError: () => undefined },
    lowerToolAccess: async () => { calls.push('foreign-stop'); }, extraModelFacingErrors: [],
    executeCommand: async ({ command, mutation }) => { calls.push(command, mutation.entityType); await mutation.captureInverse(); return { result: await mutation.execute() }; },
    approvalFingerprint: () => 'foreign-fingerprint', approvals,
    descriptions: { enable: () => 'foreign enable description', uninstall: () => 'foreign removal description' },
    messages: { familyRequired: 'foreign family required', restartNote: () => 'foreign switch saved', changedSinceConfirmation: () => 'foreign stale removal', updatePendingNextStep: () => 'foreign recovery', hostIncompatibleNote: () => 'foreign incompatible', activationsUnreadableNote: () => 'foreign unreadable', activationsBusyNote: () => 'foreign busy' },
  };
  return { required, calls };
}
test('public management entry uses foreign catalog, permission, entities and text for both families', async () => {
  const { required, calls } = fixture();const registrations=buildPluginManagementRegistrations(required);
  expect(registrations.map(r=>r.descriptor.id)).toEqual(Object.values(ids));
  expect(registrations[0]!.descriptor.description).toBe('Foreign host copy');
  const list=await registrations[0]!.handler(ctx({}),{});
  expect(list).toMatchObject({agentPlugins:[{pluginId:'guidance',archiveDigest:'foreign-digest',skills:['guide']}]});
  expect(calls[0]).toEqual({workspaceId:'foreign-space',principalId:'foreign-human',permission:'foreign.read'});
  for(const family of ['site-runtime','agent-plugin']){
    const out=await registrations[1]!.handler(ctx({family,pluginId:family==='site-runtime'?'package':'guidance',enabled:false}),{});
    expect(out).toMatchObject({family,changed:true,note:'foreign switch saved'});
  }
  expect(calls).toContainEqual({workspaceId:'foreign-space',principalId:'foreign-human',permission:'foreign.write',entityType:'foreign-package',entityId:'package'});
  expect(calls).toContainEqual({workspaceId:'foreign-space',principalId:'foreign-human',permission:'foreign.write',entityType:'foreign-guidance',entityId:'guidance'});
  expect(calls).toContain('foreign-activation');expect(calls).toContain('foreign-stop');
  expect(()=>buildPluginManagementRegistrations({...required,registration:{...required.registration,catalog:[]}})).toThrow(/foreign\.domain.*foreign\/catalog/);
});
test('public install entry uses foreign policy, warning, retry and telemetry without defaults',async()=>{
  const events:unknown[]=[];const preview={id:'package',name:'Package',version:'1.0.0',tier:'tier-1' as const,capabilities:[],hooks:[],hasCode:false,digest:'digest',contentTypes:[],conflicts:[]};
  const registration=buildPluginInstallRegistrations({registration:{domain:'foreign.install',catalogModule:'foreign/install',catalog:[{name:'foreign_install',description:'foreign install copy',sideEffects:'mutates-durable-state',authorization:{permission:'foreign.install'},inputSchema:{type:'object'}}],metadata:{}},workspaceId:'foreign-space',authorize:async input=>{events.push(input.permission);return{allowed:true,reason:'yes'};},toolId:'foreign_install',permission:'foreign.install',entityType:'foreign-package',parseRequest:()=>({opaque:'request'}),localInstallEnabled:()=>true,installInput:async()=>({archive:new Uint8Array([1])}),installer:{preview:async()=>preview,install:async input=>{events.push(input.expectedDigest);throw new PluginInstallError('PLUGIN_CHANGED_SINCE_PREVIEW','foreign refusal');}},riskSentence:()=> 'foreign trust',messages:{localInstallDisabledNote:'foreign disabled',installedNote:()=> 'foreign installed OFF',retryInstallHint:' foreign retry'},telemetry:{installed:()=>{throw new Error('unexpected success');},installFailed:input=>events.push(input.reasonClass)}})[0]!;
  expect(await registration.handler(ctx({}),{})).toEqual({installed:false,pluginId:'package',reason:'PLUGIN_CHANGED_SINCE_PREVIEW',note:'Nothing was installed: foreign refusal foreign retry'});
  expect(events).toEqual(['foreign.install','digest','refused']);
});
test('public source entry dispatches foreign operation ids and per-catalog permission',async()=>{
  const operations=['create','open','list','read','write','edit','delete','seal','rollback'] as const;const toolIds=Object.fromEntries(operations.map(op=>[op,'foreign_'+op])) as Record<typeof operations[number],string>;
  const catalog:AgentToolDefinition[]=operations.map(op=>({name:toolIds[op],description:'foreign source',sideEffects:op==='list'||op==='read'?'none':op==='delete'?'deletes-durable-state':'mutates-durable-state',authorization:{permission:'foreign.inspect'},inputSchema:{type:'object'}}));
  const seen:string[]=[];const fail=async()=>{throw new Error('unexpected source write');};
  const registrations=buildPluginSourceRegistrations({registration:{domain:'foreign.source',catalogModule:'foreign/source',catalog,metadata:{}},workspaceId:'foreign-space',authorize:async input=>{seen.push(input.permission);return{allowed:true,reason:'yes'};},toolIds,enablePermission:'foreign.write',entityType:'foreign-package',approvals,describeDelete:()=> 'foreign delete',pluginSource:{create:fail,open:fail,list:async()=>({files:[{path:'public',bytes:7}]}),read:fail,write:fail,edit:fail,delete:fail,seal:fail,rollback:fail,isSealedHere:fail,readApproval:fail,recordApproval:fail}});
  const listed=registrations.find(r=>r.descriptor.id==='foreign_list')!;expect(await listed.handler(ctx({id:'package'}),{})).toEqual({files:[{path:'public',bytes:7}]});expect(seen).toEqual(['foreign.inspect']);
});
