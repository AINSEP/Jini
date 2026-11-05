import { useId } from "react";
import { SecretInput } from "@jini-ai/ui";
import type { AdminUser } from "../models.js";
import { useLogin, type LoginHookProps, type LoginOptions } from "./hooks/use-login.hooks.js";

export interface LoginProps extends LoginHookProps, LoginOptions {
  productName: string;
  onLogin: (user: AdminUser) => void;

  useLoginHook?: typeof useLogin | undefined;
}

export function Login({ onLogin, port, translate, productName, initialUsername, useLoginHook = useLogin }: LoginProps) {
  const { username, setUsername, password, setPassword, error, busy, submit, mfa } = useLoginHook({ onLogin, port, translate }, { initialUsername });
  const t = translate;
  const passwordInputId = useId();

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={submit}>
        <h1>{productName}</h1>
        <p>{t("Sign in to your workspace")}</p>
        {mfa ? <label>
          {t("Authenticator code")}
          <input autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} data-agent-private="" value={mfa.code} onChange={e => mfa.setCode(e.target.value)} autoFocus />
        </label> : <>
        <label>
          {t("Username")}
          <input autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
        </label>
        {/* A sibling label keeps the eye toggle's name out of the input's accessible name. */}
        <div>
          <label htmlFor={passwordInputId}>{t("Password")}</label>
          <SecretInput id={passwordInputId} label={t("Password")} toggleLabels={{ show: t("Show password"), hide: t("Hide password") }}
            autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        </>}
        {error ? <div className="login-error" role="alert">{error}</div> : null}
        <button disabled={busy}>{busy ? t("Signing in…") : mfa ? t("Verify code") : t("Sign in")}</button>
        {mfa ? <button type="button" disabled={busy} onClick={mfa.cancel}>{t("Cancel")}</button> : null}
      </form>
    </div>
  );
}
