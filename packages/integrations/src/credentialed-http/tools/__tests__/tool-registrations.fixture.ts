/** Injected fakes for tool-registrations tests: every port records its exact call. */
import { vi } from 'vitest';
import { createApprovalHandler, indexCatalogById, type AgentToolDefinition, type ApprovalAnswer, type LegacyToolAuthorizeFn, type ToolExecutionContext } from '@jini-ai/core';
import type { SecretCardForm, SurfaceCardSecretRun } from '@jini-ai/core/contracts/cards';
import type { CredentialSetSummary, CredentialedRequestPort, PluginCredentialCard, SourceControlWritePort } from '@jini-ai/core/contracts/credentials';
import type { CredentialToolOperations } from '../credential-tool-operations.js';
import type { CustomCredentialSecretCards, CustomCredentialToolHost } from '../credential-tool-host.js';

export const ids = { list: 'cred_list', verify: 'cred_verify', setUsername: 'cred_user', makeRequest: 'cred_request', writeFiles: 'cred_files', save: 'cred_save' };

export const row: CredentialSetSummary = { credentialType: 'custom', id: 'row-1', label: 'Shop', category: 'general', baseUrl: 'https://api.shop.test', additionalHosts: [],
  worksFor: [], configured: true, username: 'ann', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', tokenHint: { length: 9, last4: 'WXYZ' } };

export const pluginCard: PluginCredentialCard = { pluginId: 'plug', providerId: 'prov', label: 'Plug key', category: 'general', baseUrl: 'https://api.plug.test', title: 'Plug', keyHint: 'starts pk', usedFor: ['images'] };

export function ctx(input: unknown, signal: AbortSignal = new AbortController().signal): ToolExecutionContext {
  return { executionId: 'exec-1', principal: { id: 'user-1' }, run: { id: 'run-1' }, input, signal };
}

const form = (): SecretCardForm => ({ title: 'Form', submitLabel: 'Save', fields: [{ kind: 'string', name: 'token', label: 'Token', secret: true }] });

function makeHost(): CustomCredentialToolHost {
  const catalog: AgentToolDefinition[] = [ids.list, ids.verify, ids.setUsername, ids.makeRequest, ids.writeFiles].map(name => ({ name, description: name, inputSchema: { type: 'object' }, sideEffects: 'none', authorization: { permission: 'cred.read' } }));
  return { vocabulary: { domain: 'creds', entityType: 'cred', catalogModule: 'creds/catalog.ts', permissions: { read: 'cred.read', write: 'cred.write' }, catalog: indexCatalogById({ catalog }), metadata: {} },
    cardIdentity: { uriNamespace: 'creds', appNames: { create: { appName: 'create', appVersion: '1' }, createOutcome: { appName: 'created', appVersion: '1' }, setToken: { appName: 'rotate', appVersion: '1' }, setTokenOutcome: { appName: 'rotated', appVersion: '1' } } } };
}

function makeMessages(): CredentialToolOperations['messages'] {
  return { formSaveFailure: 'save failed', noCreateChannel: 'no create channel', noRotateChannel: 'no rotate channel', noDeleteChannel: 'no delete channel', runEnded: 'run ended', invalidWorksFor: 'bad worksFor', unlabeled: 'Untitled', missingUsername: 'username required', invalidUsername: 'username invalid', probeOriginMismatch: 'origin mismatch',
    unexpectedUsername: ({ keys }) => `unexpected username fields: ${keys.join(',')}`, unexpectedToken: ({ keys }) => `unexpected token fields: ${keys.join(',')}`, notFoundLabel: ({ label }) => `no credential ${label}`, notFoundId: ({ id }) => `no id ${id}`, duplicateLabel: ({ label }) => `duplicate ${label}`, missingPluginCard: ({ providerId }) => `no card ${providerId}`, writeFailure: ({ message }) => `write failed: ${message}`, probeFailure: ({ status, keyHint, replacing }) => `probe ${status} ${keyHint ?? '-'} ${replacing}` };
}

export function makeOperations(answers: { approval?: ApprovalAnswer } = {}) {
  const sets = { list: vi.fn(async () => [row]), describe: vi.fn(async (): Promise<CredentialSetSummary | null> => row), byLabel: vi.fn(async (): Promise<CredentialSetSummary | null> => row),
    resolve: vi.fn(async (): Promise<{ baseUrl: string; connection: { token: string; username?: string } } | null> => ({ baseUrl: row.baseUrl, connection: { token: 'tok-a' } })),
    setUsername: vi.fn(async () => ({ ...row, username: 'bob' })), replace: vi.fn(async () => row), create: vi.fn(async (_input: unknown) => row) };
  const diagnostics = { describeError: vi.fn(() => 'Err'), createFailure: vi.fn(), rotateFailure: vi.fn(), writeFailure: vi.fn() };
  const invalidate = vi.fn();
  const operations: CredentialToolOperations = {
    ids, derivedRisk: new Map([ids.list, ids.verify, ids.setUsername, ids.makeRequest, ids.writeFiles].map(id => [id, 'none' as const])), modelFacingErrors: [], formErrors: [], sets, diagnostics,
    approval: { handler: steps => createApprovalHandler(steps), askHuman: vi.fn(async (): Promise<ApprovalAnswer> => answers.approval ?? { confirmed: true }), describeDelete: (p) => ({ toolId: ids.makeRequest, errorCode: 'DEL', title: `delete ${p.label} ${p.host}${p.path}`, confirmLabel: 'Yes', details: [] }) },
    pluginCards: { load: vi.fn(async () => [pluginCard]), find: vi.fn(async () => undefined), readValues: vi.fn(({ values }) => ({ label: 'Plug key', category: 'general', baseUrl: 'https://api.plug.test', token: String(values.token), additionalHosts: ['cdn.plug.test'] })) },
    credentialCardForms: { create: form, rotate: form, buildPlugin: form, applyPlugin: ({ form: f }) => f,
      createOutcome: ({ label, state, message }) => ({ title: `created ${label}`, state, message }), rotateOutcome: ({ label, state, message }) => ({ title: `rotated ${label}`, state, message }) },
    recovery: { withSetup: vi.fn(({ invoke }) => invoke()) }, publish: { loadProviders: vi.fn(async () => []), prepareInvalidation: vi.fn(async () => invalidate) },
    locale: { resolve: async () => 'en', text: ({ id }) => `text:${id}`, hint: ({ hint }) => (hint ? `ends ${hint.last4}` : ''), translate: ({ message }) => `tr:${message}` },
    policy: { guardRepo: ({ store }) => store, cleanToken: ({ token }) => token.trim(), assertFreeField: ({ value }) => { if (value.includes('!')) throw new Error('not free'); }, normalizeWorksFor: ({ value }) => { if (!Array.isArray(value)) throw new Error('bad'); return value as string[]; }, defaultCategory: 'general', isProjectConflict: () => false,
      validateWriteFiles: vi.fn(({ branch, commitMessage, files }) => ({ branch: String(branch), commitMessage: String(commitMessage), files: files as { path: string; content: string }[] })) },
    messages: makeMessages(),
  };
  return { operations, sets, diagnostics, invalidate };
}

export function makePorts() {
  const credentialedRequest = { request: vi.fn(async () => ({ executed: true as const, status: 200, headers: {}, bodyText: 'ok' })),
    resolveTarget: vi.fn(async ({ label, url }: { label: string; url: string }) => ({ label, url: new URL(url) })),
    verify: vi.fn(async () => ({ status: 'ok' as const, message: 'fine', checkedAt: 'now' })), probe: vi.fn(async () => 'ok' as const),
    classifyError: vi.fn(({ error }: { error: unknown }) => ({ category: 'unknown' as const, error })) } as unknown as CredentialedRequestPort & Record<keyof CredentialedRequestPort, ReturnType<typeof vi.fn>>;
  const provider = { planFileWrite: vi.fn(), commitFiles: vi.fn() };
  const plan = { parentCommitSha: 'p1', baseTreeSha: 't1', fileStates: [] };
  const sourceControlWrite = { build: vi.fn(async () => ({ ok: true as const, provider })), validateTarget: vi.fn(({ target }) => ({ owner: String(target.owner), repo: String(target.repo) })),
    planFileWrite: vi.fn(async () => ({ ok: true as const, plan })), commitFiles: vi.fn(async () => ({ ok: true as const, commitSha: 'c1', commitUrl: 'https://git.test/c1' })) } as unknown as SourceControlWritePort & Record<keyof SourceControlWritePort, ReturnType<typeof vi.fn>>;
  return { credentialedRequest, sourceControlWrite, provider, plan };
}

/** Scripted secret card: drives prepare/form/save/result/outcome exactly as the engine would. */
export function makeCards(script: { status: 'submit' | 'cancelled' | 'expired' | 'abandoned' | 'blank'; values?: Record<string, unknown> }) {
  const seen: { forms: unknown[]; outcomes: unknown[]; logged: unknown[]; options: unknown[] } = { forms: [], outcomes: [], logged: [], options: [] };
  const cards: CustomCredentialSecretCards = { askThenReport: vi.fn() as unknown as CustomCredentialSecretCards['askThenReport'],
    defineSecretCardTool: (spec, options) => ({ toolId: spec.toolId, secretFieldNames: () => ['token'],
      handler: () => async (c, opts) => {
        seen.options.push({ uriHost: options?.uriHost, text: options?.text, emit: typeof opts?.emitSurface });
        const prep = await spec.prepare({ ctx: c });
        seen.forms.push(spec.form({ prep }));
        let run: SurfaceCardSecretRun<never>;
        if (script.status !== 'submit') run = { status: script.status } as SurfaceCardSecretRun<never>;
        else {
          try { run = { status: 'saved', saved: await spec.save({ values: script.values ?? {}, prep, signal: c.signal }) } as SurfaceCardSecretRun<never>; }
          catch (error) {
            run = { status: 'failed', safeMessage: options?.safeError?.(error) ?? 'unsafe' };
            options?.logFailure?.({ toolId: spec.toolId, exchangeId: 'x-1', saved: false });
            seen.logged.push('x-1');
          }
        }
        seen.outcomes.push(spec.outcome({ prep, run }));
        return spec.result({ prep, run });
      } }),
  };
  return { cards, seen };
}

export function wire(options: { approval?: ApprovalAnswer; allow?: boolean } = {}) {
  const permissions: string[] = [];
  const authorize: LegacyToolAuthorizeFn = async ({ permission }) => { permissions.push(permission); return options.allow === false ? { allowed: false, reason: 'denied here' } : { allowed: true, reason: 'ok' }; };
  const loadAuthSchemes = vi.fn(async () => []);
  const routeDeps = { authorize, workspaceId: 'ws-1', loadAuthSchemes };
  return { routeDeps, permissions, host: makeHost(), ...makeOperations(options), ...makePorts() };
}
