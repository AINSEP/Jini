import type { ownerPasskeySite } from './passkey-route-deps.js';
import type { answerOwnerPasskeyFailure, resolveOwnerPasskeyRouteDeps } from './passkey-route-deps.js';
import { createOwnerPasskeyAdmission } from './passkey-admission.js';
import { OwnerRequiredError } from '../../core/types.js';
import type { beginOwnerPasskeyEnrollment, confirmOwnerPasskeyEnrollment, beginOwnerPasskeyLogin, completeOwnerPasskeyLogin, removeOwnerPasskey } from '../../server/mfa/passkey-service.js';
import type { OwnerPasskeyDeps } from '../../server/mfa/passkey-ports.js';

type Action = 'enroll' | 'confirm' | 'begin-login' | 'login' | 'remove';
type Admission = {
  workspaceId: string;
  passkeyDeps: () => Promise<OwnerPasskeyDeps>;
  authenticate: () => Promise<{ principal: { id: string }; kind: string } | null>;
  ownerPrincipalId: () => Promise<string>;
  isJson: () => boolean;
  fetchSite: () => string | undefined;
  origin: () => string | undefined;
  body: () => Record<string, unknown>;
  byteCount: () => number;
  rate: () => Promise<{ allowed: boolean; retryAfterSeconds?: number }>;
  noStore: () => void;
  retryAfter: (value: string) => void;
  json: (value: unknown, status?: number) => void;
  empty: () => void;
  failure: (error: unknown) => void;
  signedIn: (result: Awaited<ReturnType<typeof completeOwnerPasskeyLogin>>) => Promise<void>;
  services: {
    beginOwnerPasskeyEnrollment: typeof beginOwnerPasskeyEnrollment;
    confirmOwnerPasskeyEnrollment: typeof confirmOwnerPasskeyEnrollment;
    beginOwnerPasskeyLogin: typeof beginOwnerPasskeyLogin;
    completeOwnerPasskeyLogin: (required: Parameters<typeof completeOwnerPasskeyLogin>[0]) => ReturnType<typeof completeOwnerPasskeyLogin>;
    removeOwnerPasskey: typeof removeOwnerPasskey;
  };
  copy: { ownerRequired: string; origin: string; tooLarge: string; rate: string };
};

/** Authenticate management calls separately; login calls require the password-created pending proof. */
async function admit({ admission, action, deps }: { admission: Admission; action: Action; deps: OwnerPasskeyDeps }, _optional = {}) {
  if (action === 'begin-login' || action === 'login') return;
  const caller = await admission.authenticate();
  if (caller?.kind !== 'session' || caller.principal.id !== deps.mfa.seededOwnerPrincipalId) {
    throw new OwnerRequiredError({ message: admission.copy.ownerRequired });
  }
}

/** One single-send ceremony action; cap encoded registration/assertion input before verification.
 * @complexity O(b+n), b <= 16 KiB request bytes and n <= 5 credentials; no polling.
 */
export async function ownerPasskeyActionRoute({ admission, action }: { admission: Admission; action: Action }, _optional = {}): Promise<void> {
  admission.noStore();
  try {
    const deps = await admission.passkeyDeps();
    if (!admission.isJson() || admission.fetchSite() === 'cross-site' || admission.origin() !== deps.site.origin) {
      admission.json({ error: admission.copy.origin, code: 'PASSKEY_ORIGIN_REFUSED' }, 403); return;
    }
    if (admission.byteCount() > (action === 'confirm' ? 16384 : 8192)) {
      admission.json({ error: admission.copy.tooLarge, code: 'PASSKEY_TOO_LARGE' }, 413); return;
    }
    const rate = await admission.rate();
    if (!rate.allowed) { admission.retryAfter(String(rate.retryAfterSeconds));
      admission.json({ error: admission.copy.rate, code: 'RATE_LIMIT_EXCEEDED' }, 429); return; }
    await admit({ admission, action, deps });
    await execute(admission, action, deps);
  } catch (error) { admission.failure(error); }
}

/** Transport-only dispatch; scope never comes from the request body. */
async function execute(admission: Admission, action: Action, deps: OwnerPasskeyDeps) {
  const value = ({ key }: { key: string }, _optional = {}) => typeof admission.body()?.[key] === 'string' ? admission.body()[key] as string : '';
  const input = { workspaceId: admission.workspaceId, principalId: deps.mfa.seededOwnerPrincipalId,
    password: value({ key: 'password' }), code: value({ key: 'code' }), pendingToken: value({ key: 'pendingToken' }), response: admission.body()?.response, id: value({ key: 'id' }) };
  switch (action) {
    case 'enroll': admission.json(await admission.services.beginOwnerPasskeyEnrollment({ deps, input })); return;
    case 'confirm': await admission.services.confirmOwnerPasskeyEnrollment({ deps, input }); break;
    case 'begin-login': admission.json(await admission.services.beginOwnerPasskeyLogin({ deps, input })); return;
    case 'login': await admission.signedIn(await admission.services.completeOwnerPasskeyLogin({ deps, input })); return;
    case 'remove': await admission.services.removeOwnerPasskey({ deps, input }); break;
  }
  admission.empty();
}

/** Status reads only public credential identifiers for the signed-in owner, once per settings load. */
export async function ownerPasskeyStatusRoute({ admission }: { admission: Pick<Admission, 'noStore' | 'authenticate' | 'ownerPrincipalId' | 'json' | 'passkeyDeps' | 'workspaceId' | 'failure'> }, _optional = {}): Promise<void> {
  admission.noStore();
  try {
    const caller = await admission.authenticate();
    const isOwner = caller?.kind === 'session' && caller.principal.id === await admission.ownerPrincipalId();
    if (!isOwner) { admission.json({ isOwner: false, credentials: [] }); return; }
    const deps = await admission.passkeyDeps();
    const credentials = await deps.credentials.list({ workspaceId: admission.workspaceId, principalId: deps.mfa.seededOwnerPrincipalId });
    admission.json({ isOwner: true, credentials: credentials.map(c => ({ id: c.id })) });
  } catch (error) { admission.failure(error); }
}

/** Status reads only public credential identifiers for the signed-in owner, once per settings load. */
export function registerOwnerPasskeyRoutes(required: {
  root: string;
  mount(required: { method: "post" | "get"; path: string; handle: (admission: Admission) => Promise<void> }): void;
}, _optional: Record<string, never> = {}): void {
  for (const action of ["enroll", "confirm", "begin-login", "login", "remove"] as const) {
    required.mount({ method: "post", path: `${required.root}/${action}`, handle: admission => ownerPasskeyActionRoute({ action, admission }) });
  }
  required.mount({ method: "get", path: required.root, handle: async admission => {
    await ownerPasskeyStatusRoute({ admission });
  } });
}

export function bindOwnerPasskeyRoutes<Request, Response, Host>(required: {
  resolveOwnerPasskeyRouteDeps: typeof resolveOwnerPasskeyRouteDeps;
  answerOwnerPasskeyFailure: typeof answerOwnerPasskeyFailure;
  root: string;
  mount(required: { host: Host; method: 'post' | 'get'; path: string; handle(req: Request, res: Response): Promise<void> }): void;
  workspaceId(required: { host: Host }): string;
  store(required: { host: Host }): OwnerPasskeyDeps['credentials'] | undefined;
  mfa(required: { host: Host }): Promise<OwnerPasskeyDeps['mfa']>;
  webauthn(): OwnerPasskeyDeps['webauthn'];
  site(required: { host: Host; req: Request }): Parameters<typeof ownerPasskeySite>[0];
  unavailableMessage: string;
  authenticate(required: { host: Host; req: Request }): ReturnType<Admission['authenticate']>;
  ownerPrincipalId(required: { host: Host }): Promise<string>;
  isJson(required: { req: Request }): boolean;
  header(required: { req: Request; name: string }): string | undefined;
  body(required: { req: Request }): Record<string, unknown>;
  byteCount(required: { req: Request }): number;
  rate(required: { host: Host; req: Request }): ReturnType<Admission['rate']>;
  noStore(required: { res: Response }): void;
  retryAfter(required: { res: Response; value: string }): void;
  json(required: { res: Response; value: unknown; status?: number }): void;
  empty(required: { res: Response }): void;
  incident(required: { res: Response; error: unknown; options: Parameters<typeof answerOwnerPasskeyFailure>[0]['incidentOptions'] }): void;
  signedIn(required: { host: Host; req: Request; res: Response; result: Awaited<ReturnType<typeof completeOwnerPasskeyLogin>> }): Promise<void>;
  services: Admission['services']; copy: Admission['copy']; operation: string;
  incidentOptions: Parameters<typeof answerOwnerPasskeyFailure>[0]['incidentOptions'];
}, _optional = {}) {
  return (host: Host, _optional = {}): void => registerOwnerPasskeyRoutes({ root: required.root,
    mount: route => required.mount({ host, method: route.method, path: route.path,
      handle: (req, res) => route.handle(createOwnerPasskeyAdmission({ required, host, req, res })),
    }),
  });
}
