import { expect, it } from 'vitest';
import { askThenReport, createSurfaceExchangeStore } from '@jini-ai/daemon/surface-exchanges';
import { defineSecretCardTool } from '@jini-ai/ui/mcp-ui/secret-card';
import { buildDeployOpsRegistrations, runDeploy, type DeployOpsRuntime, type DeployOpsRegistrationHost } from '@jini-ai/devops/deploy';

it('a public deployment consumer wires foreign ids, policy, cards and bounded I/O with no host defaults',async()=>{
 const calls:string[]=[];
 const platform={pluginId:'archive-module',descriptor:{id:'archive',label:'Archive',module:'archive.mjs',hosts:['api.archive.test']},module:{status:async()=>({platform:'archive',target:'book',state:'healthy' as const,summary:'Archive online',items:[],checkedAt:''}),logs:async()=>({platform:'archive',target:'book',lines:[],truncated:false}),deploy:async()=>({platform:'archive',target:'book',started:true,summary:'Archive queued'})}};
 const deps:DeployOpsRuntime={workspaceId:'archive-room',clock:{nowMs:()=>0},loadDeployOps:async()=>({get:()=>platform,list:()=>[platform],refusals:[]}),
 credentials:{available:true,list:async()=>[{label:'archive-key',allowedOrigins:['https://api.archive.test']}],resolveTarget:async({label,url})=>({label,url:new URL(url)}),classifyError:({error})=>({category:'unknown',error}),request:async()=>({executed:true,status:200,headers:{},bodyText:'{}',bodyTruncated:false})},
 siteKey:{read:()=>undefined,fingerprint:()=>({fingerprint:'archive-fingerprint',fingerprintKind:'sha256'})},recovery:{setupRequired:()=>({message:'Archive reconnect',credentialSetup:{setupToolId:'archive_reconnect'}})},
 toolIds:{status:'archive_state',logs:'archive_logs',wait:'archive_watch',listTargets:'archive_targets',deploy:'archive_dispatch',listSecrets:'archive_names',setSecret:'archive_write',unsetSecret:'archive_remove',credentialVerify:'archive_check'},
 messages:{noUsableSiteKey:'Archive has no key',severalCredentials:()=> 'Archive choose',noSavedCredential:()=> 'Archive absent'},publishHistoryStore:{recordSuccess:async({entry})=>{calls.push(entry.target);}},
 };
 const exchanges=createSurfaceExchangeStore({clock:{nowMs:()=>0},idGenerator:{newId:()=> 'archive-card'},defaultChannel:'mcp-ui',scheduler:{schedule:()=>()=>undefined}});
 const host:DeployOpsRegistrationHost={domain:'archive-domain',catalogModule:'archive/catalog.ts',metadata:{},derivedRisk:new Map([['archive_dispatch','mutates-durable-state']]),catalog:[{name:'archive_dispatch',description:'Archive dispatch',inputSchema:{type:'object'},authorization:{permission:'archive.publish'},sideEffects:'mutates-durable-state'}],permissions:{write:'archive.change',siteKey:'archive.copy'},permit:async({permission})=>{calls.push(permission);},approvals:{confirmFor:()=>undefined},
 cards:{defineSecretCardTool,askThenReport,surfaceExchanges:exchanges,uriHost:'archive',defaultLocale:'archive',noEmitter:'Archive human needed',locale:async()=> 'archive',form:()=>({title:'Archive private input',submitLabel:'Archive save',fields:[{name:'value',kind:'string',label:'Archive secret',secret:true}]}),text:({id})=>`Archive ${id}`}};
 const registrations=buildDeployOpsRegistrations({deps,host},{});
 expect(registrations.map(r=>r.descriptor.id)).toEqual(['archive_dispatch']);
 const ctx={executionId:'archive-call',principal:{id:'archivist'},run:{id:'archive-run'},signal:new AbortController().signal,input:{platform:'archive',target:'book'}};
 expect(await registrations[0]!.handler(ctx)).toEqual({platform:'archive',target:'book',started:true,summary:'Archive queued'});
 expect(calls).toEqual(['archive.publish','archive']);
 expect(await runDeploy({deps,input:{platform:'archive',target:'book'}},{})).toEqual({platform:'archive',target:'book',started:true,summary:'Archive queued'});
 expect(exchanges.size()).toBe(0);
});
