import type { ComponentType } from "react";
import { createLoginTranslator } from "./Login.hooks.js";
import type { AdminUser } from "@jini-ai/core/contracts/site/user-management-react";
import type { Translate } from "@jini-ai/core/text";
import type { LoginController, LoginHookProps } from "./hooks/use-login.hooks.js";
import type { AuthErrorNotice, AuthPasskeySignIn, AuthSecretInput } from "./auth-host-slots.js";

/**
 * @file The Login screen — markup only.
 *
 * State and the submit handler live in `hooks/use-login.hooks.ts`. Nothing here computes a value
 * (no derivations, no branchy formatting), so this feature has no `rules.ts`.
 */
export interface LoginProps {
  onLogin: (user: AdminUser) => void;
  /**
   * Dependency injection seam for tests — the same convention `Posts.tsx`'s `usePostsHook` and
   * `@jini-ai/ui`'s `useCustomSelect` use. The host passes its wired hook (`useWiredLogin`).
   */
  useLoginHook: (props: LoginHookProps) => LoginController;
  /** The host's locale hook. */
  useAdminLocaleHook: () => string;
  /** The product name shown as the sign-in heading (host copy, K3). */
  productName: string;
  /** The host's secret input, error notice and bound passkey button. */
  SecretInput: AuthSecretInput; ErrorNotice: AuthErrorNotice; PasskeySignIn: AuthPasskeySignIn;
  /** The host's owner-recovery sign-in, with its recovery client already bound. */
  OwnerRecoverySignIn: ComponentType<{ t: Translate }>;
  /** The host's current-user call (`/auth/me`), read after a passkey completes. */
  loadCurrentUser: () => Promise<{ user: AdminUser }>;
}

export function Login({ onLogin, useLoginHook, useAdminLocaleHook, productName, SecretInput, ErrorNotice, PasskeySignIn, OwnerRecoverySignIn, loadCurrentUser }: LoginProps) {
  const { username, setUsername, password, setPassword, error, failure, busy, submit, mfa } = useLoginHook({ onLogin });
  const locale = useAdminLocaleHook();
  const t = createLoginTranslator({ locale });

  return (
    <div className="jini-login-screen">
      <form className="jini-login-card" onSubmit={submit}>
        <h1>{productName}</h1>
        <p>{t("Sign in to your workspace")}</p>
        {mfa ? <label>
          {t("Authenticator code")}
          <input autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} data-agent-private="" value={mfa.code} onChange={event => mfa.setCode(event.target.value)} autoFocus />
        </label> : <>
        <label>
          {t("Username")}
          <input autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
        </label>
        {/* Not wrapped in its <label> like Username: the eye toggle's name would join the input's. */}
        <div className="jini-login-field">
          <label htmlFor="login-password">{t("Password")}</label>
          <SecretInput label={t("Password")} locale={locale} id="login-password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        </>}
        {failure ? <ErrorNotice failure={failure} t={t} className="jini-login-error" /> : error ? <div className="jini-login-error">{error}</div> : null}
        <button disabled={busy}>{busy ? t("Signing in…") : mfa ? t("Verify code") : t("Sign in")}</button>
        {mfa ? <button type="button" disabled={busy} onClick={mfa.cancel}>{t("Cancel")}</button> : null}
      </form>
      {mfa ? <PasskeySignIn pendingToken={mfa.pendingToken} translate={t}
        onComplete={async () => { const result = await loadCurrentUser(); onLogin(result.user); }} /> : null}
      <OwnerRecoverySignIn t={t} />
    </div>
  );
}
