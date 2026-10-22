import { expect, it } from 'vitest';
import { buildCapabilityScopedSdk, CapabilityDeniedError } from '../../capability-sdk.js';
import { createPluginContributionCapture, renderPluginWidgetFragments, createPluginContributionRegistry } from '../../contributions.js';
import { buildPluginContributionToolRegistrations, attachPluginContributionTools } from '../../tool-contributions.js';
import { createToolRegistry } from '@jini-ai/core';
import type { PluginManifest } from '../../manifest.js';
import { pluginSdkBinding } from '../support/fixture-bindings.js';
const manifest: PluginManifest = {id:'sample',name:'Sample',version:'0.1.0',sdkRange:'*',engine:1,tier:'tier-3',capabilities:['http.route.register','tools.register','render.contribute'],hooks:[],fields:[],integrity:{},contributes:{routes:['GET /hello'],tools:['hello'],widgets:['hello']}};
const core = { getCurrentEntry:()=>({workspaceId:'ws',ext:{}}), writeExtField:()=>{}, attachFilter:()=>{} };
it('each new SDK position always exists and synchronously denies without its own grant', () => {
  const sdk = buildCapabilityScopedSdk({pluginId:manifest.id,pluginSdkBinding,capabilities:[],coreDeps:core});
  for (const [call,capability] of [
    [()=>sdk.routes.add({method:'GET',path:'/hello',access:'public',handler:()=>({})}),'http.route.register'],
    [()=>sdk.tools.add({name:'hello',description:'hello',inputSchema:{type:'object'},handler:()=>null}),'tools.register'],
    [()=>sdk.widgets.add({name:'hello',render:()=>'<b>Hello</b>'}),'render.contribute'],
  ] as const) {
    try {call();expect.fail('ungranted surface must deny');} catch(error) { expect(error).toBeInstanceOf(CapabilityDeniedError); expect((error as CapabilityDeniedError).capability).toBe(capability); }
  }
  expect(()=>sdk.addAction()).toThrow(CapabilityDeniedError);
  const granted = buildCapabilityScopedSdk({pluginId:manifest.id,pluginSdkBinding,capabilities:['hooks.attach'],coreDeps:core});
  expect(()=>granted.addAction()).toThrow(/no plugin action hooks/);
});
it('addContribution routes through the same capability gate and capture, and rejects unknown kinds', () => {
  const capture = createPluginContributionCapture({manifest});
  const sdk = buildCapabilityScopedSdk({pluginId:manifest.id,pluginSdkBinding,capabilities:manifest.capabilities,coreDeps:{...core,contributions:capture}});
  sdk.addContribution({kind:'route',value:{method:'GET',path:'/hello',access:'public',handler:()=>({body:'hello'})}});
  sdk.addContribution({kind:'tool',value:{name:'hello',description:'hello',inputSchema:{type:'object'},handler:()=>null}});
  sdk.addContribution({kind:'widget',value:{name:'hello',render:()=>'<b>Hello</b>'}});
  const snapshot = capture.seal({sdk}); expect([snapshot.routes.length,snapshot.tools.length,snapshot.widgets.length]).toEqual([1,1,1]);
  expect(()=>sdk.addContribution({kind:'unsupported'} as never)).toThrow(/unsupported/);
});
it('public SSR isolates invalid HTML, timeout and disable; host validation is mandatory', async () => {
  const registry = createPluginContributionRegistry({}); const capture = createPluginContributionCapture({manifest});
  let enabled = true;
  capture.widgets.add({name:'hello',render:()=>'<b>Hello</b>'});
  const sdk = buildCapabilityScopedSdk({pluginId:manifest.id,pluginSdkBinding,capabilities:[],coreDeps:core});
  registry.replace({contributions:capture.seal({sdk})});
  const ports = {registry,names:['hello'],workspaceId:'ws',isEnabled:async()=>enabled,validateHtml:({html}:{html:string})=> html};
  const errors: Array<{ pluginId: string; widgetName: string; error: unknown }> = [];
  const onError = (failure: typeof errors[number]) => { errors.push(failure); };
  expect((await renderPluginWidgetFragments(ports)).hello).toBe('<b>Hello</b>');
  expect((await renderPluginWidgetFragments({...ports,validateHtml:()=>{throw new Error('unsafe');}}, { onError })).hello).toBe('');
  expect(errors[0]?.pluginId).toBe('sample'); expect(errors[0]?.widgetName).toBe('hello'); expect(String(errors[0]?.error)).toContain('unsafe');
  enabled=false;expect((await renderPluginWidgetFragments(ports)).hello).toBeUndefined();
  enabled=true;
  const slow = createPluginContributionCapture({manifest});slow.widgets.add({name:'hello',render:()=>new Promise<string>(()=>{})});registry.replace({contributions:slow.seal({sdk})});
  expect((await renderPluginWidgetFragments(ports,{timeoutMs:1,onError})).hello).toBe('');
  expect(errors).toHaveLength(2); expect(String(errors[1]?.error)).toContain('widget timeout');
  await expect(renderPluginWidgetFragments({...ports,names:Array.from({length:33},(_,i)=>String(i))})).rejects.toThrow(/too many/);
});
it('tool attachment is disposable and policy/handler recheck both host auth and current generation', async () => {
  const contributions = createPluginContributionRegistry({}); const registry = createToolRegistry({});
  let enabled=true, authorized=true;
  const ports = { contributions,isEnabled:async()=>enabled,resolveAuth:async()=> authorized ? {access:'admin' as const,workspaceId:'ws',principalId:'owner'} : null,metadata:{approval:{class:'publish' as const,confirmation:'direct' as const}} };
  const attached = attachPluginContributionTools({...ports,registry});
  const capture=createPluginContributionCapture({manifest});capture.tools.add({name:'hello',description:'hello',inputSchema:{type:'object'},handler:({auth})=>auth.principalId});
  const sdk=buildCapabilityScopedSdk({pluginId:manifest.id,pluginSdkBinding,capabilities:[],coreDeps:core});
  contributions.replace({contributions:capture.seal({sdk})});
  expect(registry.has({toolId:'p_sample__hello'})).toBe(true);
  const [registration] = buildPluginContributionToolRegistrations(ports);expect(registration).toBeDefined();
  expect(registration!.descriptor.requiresConfirmation).toBe(false);
  expect(registration!.descriptor.metadata?.approval).toEqual({class:'publish',confirmation:'direct'});
  expect(buildPluginContributionToolRegistrations({...ports,metadata:{approval:{class:'publish',confirmation:'policy'}}})[0]!.descriptor.requiresConfirmation).toBe(true);
  const ctx={principal:{id:'owner'},run:{id:'r'},input:{},tool:registration!.descriptor};
  expect(await registration!.policy.authorize(ctx)).toBe('allow');
  authorized=false;expect(await registration!.policy.authorize(ctx)).toBe('deny');
  authorized=true;enabled=false;expect(await registration!.policy.authorize(ctx)).toBe('deny');
  enabled=true;contributions.detach({pluginId:manifest.id});expect(registry.has({toolId:'p_sample__hello'})).toBe(false);
  await expect(registration!.handler({...ctx,executionId:'e',signal:new AbortController().signal})).rejects.toThrow(/disabled/);
  attached.dispose({});expect(contributions.list({})).toEqual([]);
});
it('a granted route, tool or widget contribution fails loudly when the host never bound contributions', () => {
  const sdk = buildCapabilityScopedSdk({pluginId:manifest.id,pluginSdkBinding,capabilities:['http.route.register','tools.register','render.contribute'],coreDeps:core});
  // The capability check passes; the missing host binding is what refuses, never a silent no-op.
  expect(()=>sdk.routes.add({method:'GET',path:'/hello',access:'public',handler:()=>({})})).toThrow('plugin routes are not bound by this host');
  expect(()=>sdk.tools.add({name:'hello',description:'hello',inputSchema:{type:'object'},handler:()=>null})).toThrow('plugin tools are not bound by this host');
  expect(()=>sdk.widgets.add({name:'hello',render:()=>'<b>Hello</b>'})).toThrow('plugin widgets are not bound by this host');
});
