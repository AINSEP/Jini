import type { TotpSettingsPort } from "@jini-ai/core/contracts/site/user-management-react";
import type { AdminHttpError } from "@jini-ai/core/admin-runtime";

import type { AdminHttp } from "./admin-http/request.js";

/** The one host request operation the owner auth ports send through: its single-send request. */
export type AdminRequestOnceOps = Pick<AdminHttp<AdminHttpError, string, string>, "requestOnce">;

/** Thin site transport: single-send writes never replay a proof after a lost response.
 * The host injects its bound `requestOnce`; a host binds once.
 * @complexity O(1), one request per explicit action; status loads once, no poll.
 */
export function createOwnerMfaPort({ http }: { http: AdminRequestOnceOps }, _optional: Record<string, never> = {}): TotpSettingsPort {
  const post = <T,>({ action, input }: { action: string; input: unknown }, _options = {}): Promise<T> => http.requestOnce<T>({
    path: `/auth/mfa/${action}`, init: { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(input), cache: "no-store" },
  });
  return {
    status: () => http.requestOnce({ path: "/auth/mfa", init: { cache: "no-store" } }),
    enroll: input => post({ action: "enroll", input }),
    confirm: input => post({ action: "confirm", input }),
    remove: input => post({ action: "remove", input }),
  };
}
