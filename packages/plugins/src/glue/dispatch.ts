import { resolveCallSiteDispatch } from './manifest.js';

export type GlueDispatcherPort = (required: { moduleId: string; callSite: string; payload: Readonly<Record<string, unknown>> }) => unknown;

/** Host delegates define what a wired call site does; unwired sites never silently dispatch. */
export function dispatchGlueAttachment(required: {
  moduleId: string;
  callSite: string;
  payload: Readonly<Record<string, unknown>>;
  wiredCallSites: readonly string[];
  dispatch: GlueDispatcherPort;
}, _optional: Record<string, never> = {}): { readonly wired: false; readonly code: 'UNWIRED_CALL_SITE' } | { readonly wired: true; readonly result: unknown } {
  const status = resolveCallSiteDispatch(required);
  if (!status.wired) return status;
  return { wired: true, result: required.dispatch({ moduleId: required.moduleId, callSite: required.callSite, payload: required.payload }) };
}
