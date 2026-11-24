import { useState } from "react";
import { formatUserFacingError, type UserFacingError } from "@jini-ai/core";

import type { AdminUser } from "@jini-ai/core/contracts/site/user-management-react";
import type { LoginPort } from "./login-port.hooks.js";
import type { BaseLoginController, LoginApiErrorPort, UseBaseLoginHook } from "../auth-host-slots.js";

/**
 * @file Everything the Login screen does, so `Login.tsx` is only markup.
 *
 * Keeps submission order and refusal messages; unexpected failures also carry safe copy details. Naming follows
 * `hooks/use-settings-slice.hooks.ts`: `use-<thing>.hooks.ts`. Feature-local because nothing
 * outside `features/auth` needs it.
 *
 * `deps.port` is injected (see `login-port.hooks.ts`) rather than reaching for `lib/api`'s `api`
 * directly, so a test can describe a login attempt against `createFakeLoginPort` instead of
 * stubbing global `fetch`. `useWiredLogin` below is the zero-dependency pair `Login.tsx` actually
 * mounts. `onLogin` moved from a bare positional argument into `props` (same `(props, deps)` shape
 * as `useFormEditor`/`useEditMediaPanel`) now that this hook takes a second, injected argument —
 * a lone trailing object could no longer be told apart from `deps` by position alone.
 *
 * The host binds `useWiredLogin` (its live port, its admin HTTP error class as `errors`, and the
 * base login controller hook as `useJiniLogin`); this file imports none of them.
 */

export interface LoginHookProps {
  onLogin: (user: AdminUser) => void;
}

export interface LoginDependencies {
  port: LoginPort;
  errors: LoginApiErrorPort;
  useJiniLogin: UseBaseLoginHook;
}

export interface LoginController extends BaseLoginController {
  failure?: UserFacingError | null;
}

/** Keep safe server refusals, correlate unexpected failures without copying a submitted proof.
 * @complexity O(diagnostic length), no effects or retained credentials.
 */
function loginFailure({ err, secrets, errors }: { err: unknown; secrets: string[]; errors: LoginApiErrorPort }, _optional = {}): UserFacingError | null {
  if (errors.isApiError(err) && [400, 401, 429].includes(err.status)) return null;
  const errorId = errors.isApiError(err) && typeof err.body?.errorId === "string" ? err.body.errorId : undefined;
  // Anonymous copy never contains a transport exception or backend diagnosis, even redacted.
  return formatUserFacingError({ message: "Sign-in could not finish.",
    action: "Try signing in again. If it still fails, copy details and report this problem.",
    step: "auth-login", cause: "The sign-in request did not finish. Its error ID identifies the server report." },
  { ...(errorId === undefined ? {} : { errorId }), exactSecrets: secrets.filter(Boolean) });
}

/**
 * @param props `onLogin` — called with the authenticated user once `submit` resolves.
 * @param deps `port` — the injected login transport; see `login-port.hooks.ts`.
 * @returns The login screen's full controller — see {@link LoginController}.
 * @complexity Time/space: O(1) — one credential round trip per submit, no iteration.
 */
export function useLogin({ onLogin }: LoginHookProps, { port, errors, useJiniLogin }: LoginDependencies): LoginController {
  const [failure, setFailure] = useState<UserFacingError | null>(null);
  async function observed<T>({ execute, secrets }: { execute: () => Promise<T>; secrets: string[] }, _optional = {}): Promise<T> {
    setFailure(null);
    try { return await execute(); }
    catch (err) {
      setFailure(loginFailure({ err, secrets, errors }));
      throw err instanceof Error ? err : new Error("Sign-in could not finish. Try signing in again.");
    }
  }
  const completeMfa = port.completeMfa;
  const controller = useJiniLogin({ onLogin, translate: text => text,
    port: { login: input => observed({ execute: () => port.login(input), secrets: [input.password] }),
      ...(completeMfa ? { completeMfa: (input: { pendingToken: string; code: string }) =>
        observed({ execute: () => completeMfa.call(port, input), secrets: [input.code, input.pendingToken] }) } : {}) } }, { initialUsername: "admin" });
  return { ...controller, failure };
}
