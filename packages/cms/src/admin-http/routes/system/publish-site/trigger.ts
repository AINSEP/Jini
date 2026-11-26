import { defineJsonRoute, ok, routeReply, type JsonRouteSpec } from '@jini-ai/core/contracts/server';
import { authorizePublish, type PublishSitePrincipal } from './shared.js';

export interface PublishTriggerDeps<TConfig, TSnapshot extends { status: string }> {
  readConfig(required: { targetId: string; raw: Record<string, unknown> }): Promise<{ ok: true; config: TConfig } | { ok: false; error: string }>;
  plan(required: { config: TConfig }): { ok: true } | { ok: false; message: string };
  hasCustomDomain(required: { config: TConfig }): boolean;
  domainConfirmationText: string;
  deploymentCheck(required: { principalId: string }): Promise<Record<string, unknown> | undefined>;
  snapshot(required: Record<string, never>): TSnapshot;
  start(required: { config: TConfig; projectName: string; principalId: string; credentialId?: string }): TSnapshot;
  onBlocked(required: { principalId: string; reasonClass: 'config' | 'consent' | 'busy' }): void;
}

/**
 * Parses and shape-validates the trigger request body's TARGET-INDEPENDENT fields. Never throws —
 * every malformed shape maps to a `{ok:false, error}` result this route turns into a `400`, matching
 * `export-site.ts`'s own `parseTriggerRequestBody` discipline. Which config fields `target` takes,
 * and whether their values are valid, is judged by the registry (`readStaticPublishConfig` +
 * `planStaticPublish`), so a caller only ever gets one canonical rejection for the same bad value.
 */
function parsePublishRequestBody({ body }: { body: unknown }, _optional = {}): { ok: true; raw: Record<string, unknown>; targetId: string; projectName: string; credentialId?: string } | { ok: false; error: string } {
  const raw = asJsonObject({ body });
  if (!raw) {
    return { ok: false, error: "request body must be a JSON object" };
  }

  if (typeof raw.projectName !== "string" || raw.projectName.trim() === "") {
    return { ok: false, error: "'projectName' (non-empty string) is required" };
  }

  // Shape only, same discipline as every other field here — whether this id names a connection this
  // workspace actually owns, for this target, is judged exactly once, by the credential source
  // (`static-publish/credentials.ts`). Optional because the agent tool and env-var installs have no
  // connection id to send; see this file's header for the full backward-compatibility contract.
  if (!validOptionalCredential({ value: raw.credentialId })) {
    return { ok: false, error: "'credentialId' must be a non-empty string when present" };
  }

  if (typeof raw.target !== "string" || raw.target.trim() === "") {
    return { ok: false, error: "'target' (non-empty string) is required" };
  }
  return {
    ok: true,
    raw,
    targetId: raw.target,
    projectName: raw.projectName,
    ...(typeof raw.credentialId === "string" ? { credentialId: raw.credentialId } : {}),
  };
}

/** The body as a plain object, or `null` for a non-object, `null` or array body. */
function asJsonObject({ body }: { body: unknown }, _optional = {}): Record<string, unknown> | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  return body as Record<string, unknown>;
}

function validOptionalCredential({ value }: { value: unknown }, _options = {}): boolean {
  return value === undefined || (typeof value === "string" && value.trim() !== "");
}

export function createPublishTriggerRoute<TConfig, TSnapshot extends { status: string }>(
  _required: { deps: PublishTriggerDeps<TConfig, TSnapshot> }, _optional = {},
): JsonRouteSpec<{ body: unknown }, unknown, PublishTriggerDeps<TConfig, TSnapshot>, PublishSitePrincipal> {
  return defineJsonRoute<{ body: unknown }, unknown, PublishTriggerDeps<TConfig, TSnapshot>, PublishSitePrincipal>({
    method: 'post', path: '/api/admin/v1/workspaces/:workspaceId/system/publish',
    parse: raw => ok({ value: { body: raw.body } }),
    handle: async ({ input, deps, context, authorize }) => {
      await authorizePublish({ authorize, permission: 'system.publish' });
      if (!context) throw new Error('publish-site route has no authenticated principal');
      const checked = await checkPublishPreconditions({ deps, principalId: context.id, body: input.body });
      if (!checked.ok) {
        deps.onBlocked({ principalId: context.id, reasonClass: checked.reasonClass });
        return ok({ value: routeReply({ status: checked.status, body: checked.body }) });
      }
      // No `await` between this check and `startPublishRun` below — same single-synchronous-stretch
      // reasoning `export-site.ts`'s own trigger route documents, so two concurrent POSTs cannot both
      // observe "idle". This is now ALSO the same guard `deployment_execute_static_publish`
      // (`publish-agent-tools.ts`) checks before its own confirmed publish call — both read/write the
      // ONE shared slot in `static-publish/publish-run.ts`, so a concurrent trigger from either caller
      // is refused, not raced (Terra audit finding #1).
      const snapshot = deps.snapshot({});
      if (snapshot.status === 'running') {
        deps.onBlocked({ principalId: context.id, reasonClass: 'busy' });
        return ok({ value: routeReply({ status: 409, body: { error: 'a publish is already running', run: snapshot } }) });
      }
      // Deliberately not awaited — see this file's header for why the response returns before the
      // publish finishes. `startPublishRun` itself keeps the shared slot in sync as the publish
      // settles, so a poller can never observe a stale "running" snapshot after the promise has
      // actually settled.
      return ok({ value: deps.start({ config: checked.config, projectName: checked.parsed.projectName, principalId: context.id,
        ...(checked.parsed.credentialId === undefined ? {} : { credentialId: checked.parsed.credentialId }),
      }) });
    },
  }, { successStatus: 202 });
}

/** Everything that can refuse a publish before the shared run slot is touched, in the order the refusals apply. */
async function checkPublishPreconditions<TConfig, TSnapshot extends { status: string }>({ deps, principalId, body }: {
  deps: PublishTriggerDeps<TConfig, TSnapshot>; principalId: string; body: unknown;
}): Promise<{ ok: true; parsed: Extract<ReturnType<typeof parsePublishRequestBody>, { ok: true }>; config: TConfig } | { ok: false; status: number; body: Record<string, unknown>; reasonClass: 'config' | 'consent' | 'busy' }> {
  const parsed = parsePublishRequestBody({ body });
  if (!parsed.ok) return { ok: false, status: 400, body: { error: parsed.error }, reasonClass: 'config' };
  // Fails fast, before flipping the shared run slot to "running" or touching the
  // filesystem/network at all, on a config `publishStaticSite` would reject anyway — the same
  // `planStaticPublish` verdict `publishStaticSite` reaches internally — so a caller who only sends
  // a malformed config never sees a "running" snapshot at all.
  const read = await deps.readConfig({ targetId: parsed.targetId, raw: parsed.raw });
  if (!read.ok) return { ok: false, status: 400, body: { error: read.error }, reasonClass: 'config' };
  const plan = deps.plan({ config: read.config });
  if (!plan.ok) return { ok: false, status: 400, body: { error: plan.message }, reasonClass: 'config' };
  if (deps.hasCustomDomain({ config: read.config })) return { ok: false, status: 409, body: { code: 'DOMAIN_CONFIRMATION_REQUIRED', error: deps.domainConfirmationText }, reasonClass: 'config' };
  const consent = await deps.deploymentCheck({ principalId });
  if (consent) return { ok: false, status: 409, body: consent, reasonClass: 'consent' };
  return { ok: true, parsed, config: read.config };
}

export function registerPublishTriggerRoute<TConfig extends { target: string; customDomain?: string | undefined }, TRegistry, TSnapshot extends { status: string }>(required: {
  mount(required: {
    spec: ReturnType<typeof createPublishTriggerRoute<{ config: TConfig; registry: TRegistry }, TSnapshot>>;
    deps: PublishTriggerDeps<{ config: TConfig; registry: TRegistry }, TSnapshot>;
    refusal: (facts: { response: { status: number; body: unknown }; json: (body: unknown, status: number) => void; principalId: () => string }) => void;
    failure: (facts: { error: unknown; incident: (error: unknown, options: { operation: string; code: string }) => void }) => void;
  }): void;
  readConfig(required: { targetId: string; raw: Record<string, unknown>; blankAsAbsent: boolean }): Promise<{ ok: true; config: TConfig; registry: TRegistry } | { ok: false; error: string }>;
  plan(required: { registry: TRegistry; config: TConfig }): { ok: true } | { ok: false; message: string };
  start(required: { principal: { id: string }; parsed: { projectName: string; credentialId?: unknown }; config: TConfig }): TSnapshot;
  snapshot: () => TSnapshot;
  siteConsent: { deploymentCheck(required: { principalId: string; permission: string }): Promise<Record<string, unknown> | null | undefined> } | undefined;
  consentUnavailable: () => Record<string, unknown>;
  domainConfirmationText: string;
  onBlocked: (required: { principalId: string; reasonClass: "config" | "consent" | "busy" | "auth" }) => void;
  operation: string;
}, _optional = {}): void {
  const deps: PublishTriggerDeps<{ config: TConfig; registry: TRegistry }, TSnapshot> = {
    readConfig: async ({ targetId, raw }) => {
      const read = await required.readConfig({ targetId, raw, blankAsAbsent: false });
      return read.ok ? { ok: true, config: { config: read.config, registry: read.registry } } : read;
    },
    plan: ({ config: read }) => required.plan({ registry: read.registry, config: read.config }),
    hasCustomDomain: ({ config: read }) => Boolean(read.config.customDomain),
    domainConfirmationText: required.domainConfirmationText,
    deploymentCheck: async ({ principalId }) => (required.siteConsent ? await required.siteConsent.deploymentCheck({ principalId, permission: "system.publish" }) : required.consentUnavailable()) ?? undefined,
    snapshot: required.snapshot,
    start: ({ config: read, projectName, principalId, credentialId }) => required.start({ principal: { id: principalId }, config: read.config, parsed: { projectName, ...(credentialId === undefined ? {} : { credentialId }) } }),
    onBlocked: required.onBlocked,
  };
  required.mount({ spec: createPublishTriggerRoute({ deps }), deps,
    refusal: facts => {
      facts.json(facts.response.body, facts.response.status);
      if (facts.response.status === 403) required.onBlocked({ principalId: facts.principalId(), reasonClass: "auth" });
    },
    failure: facts => facts.incident(facts.error, { operation: required.operation, code: "INTERNAL_ERROR" }),
  });
}
