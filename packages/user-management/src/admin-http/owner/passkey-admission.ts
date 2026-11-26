import type { bindOwnerPasskeyRoutes } from './passkey-routes.js';

export function createOwnerPasskeyAdmission<Request, Response, Host>({ required, host, req, res }: {
  required: Parameters<typeof bindOwnerPasskeyRoutes<Request, Response, Host>>[0]; host: Host; req: Request; res: Response;
}, _optional = {}) {
  return {
    workspaceId: required.workspaceId({ host }),
    passkeyDeps: () => required.resolveOwnerPasskeyRouteDeps({
      store: () => required.store({ host }), mfa: () => required.mfa({ host }), webauthn: required.webauthn,
      get site() { return required.site({ host, req }); }, unavailableMessage: required.unavailableMessage,
    }),
    authenticate: () => required.authenticate({ host, req }),
    ownerPrincipalId: () => required.ownerPrincipalId({ host }),
    isJson: () => required.isJson({ req }),
    fetchSite: () => required.header({ req, name: 'sec-fetch-site' }),
    origin: () => required.header({ req, name: 'origin' }),
    body: () => required.body({ req }), byteCount: () => required.byteCount({ req }),
    rate: () => required.rate({ host, req }), noStore: () => required.noStore({ res }),
    retryAfter: (value: string) => required.retryAfter({ res, value }),
    json: (value: unknown, status?: number) => required.json({ res, value, ...(status === undefined ? {} : { status }) }),
    empty: () => required.empty({ res }),
    failure: (error: unknown) => required.answerOwnerPasskeyFailure({ error, json: (value, status) => required.json({ res, value, status }), incident: (error, options) => required.incident({ res, error, options }), operation: required.operation, incidentOptions: required.incidentOptions }),
    signedIn: (result: Parameters<Parameters<typeof bindOwnerPasskeyRoutes<Request, Response, Host>>[0]['signedIn']>[0]['result']) => required.signedIn({ host, req, res, result }),
    services: required.services, copy: required.copy,
  };
}
