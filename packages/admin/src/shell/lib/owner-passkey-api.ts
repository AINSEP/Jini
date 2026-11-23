import type { PasskeySettingsPort, PasskeySignInPort } from "@jini-ai/core/contracts/site/user-management-react";

import type { AdminRequestOnceOps } from "./owner-mfa-api.js";

/** The owner's passkey settings and sign-in ports, both over one host request client. */
export interface OwnerPasskeyPorts { settings: PasskeySettingsPort; signIn: PasskeySignInPort }

/** Explicit ceremonies are single-send requests; lost responses never trigger proof replay.
 * The host injects its bound `requestOnce`; a host binds once.
 * @complexity O(1) to build; one request per explicit action.
 */
export function createOwnerPasskeyPorts({ http }: { http: AdminRequestOnceOps }, _optional: Record<string, never> = {}): OwnerPasskeyPorts {
  const post = <T,>({ action, input }: { action: string; input: unknown }, _options = {}): Promise<T> => http.requestOnce<T>({
    path: `/auth/passkeys/${action}`, init: { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(input), cache: "no-store" },
  });
  return {
    settings: {
      status: () => http.requestOnce({ path: "/auth/passkeys", init: { cache: "no-store" } }),
      enroll: input => post({ action: "enroll", input }), confirm: input => post({ action: "confirm", input }), remove: input => post({ action: "remove", input }),
    },
    signIn: {
      begin: input => post({ action: "begin-login", input }), complete: async input => { await post({ action: "login", input }); },
    },
  };
}
