import { useId } from "react";
import type { Translate } from "@jini-ai/ui/panel-kit";
import { SecretInput } from "@jini-ai/ui";
import type { AdminUser } from "../models.js";
import { useLogin, type LoginHookProps, type LoginOptions } from "./hooks/use-login.hooks.js";

export interface LoginProps extends LoginHookProps, LoginOptions {
  productName: string;
  onLogin: (user: AdminUser) => void;

  useLoginHook?: typeof useLogin | undefined;
}

export function Login({ onLogin, port, translate, productName, initialUsername, useLoginHook = useLogin }: LoginProps) {
  const { username, setUsername, password, setPassword, error, busy, submit } = useLoginHook({ onLogin, port, translate }, { initialUsername });
  const t = translate;
  const passwordLabelId = useId();

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={submit}>
        <h1>{productName}</h1>
        <p>{t("Sign in to your workspace")}</p>
        <label>
          {t("Username")}
          <input autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
        </label>
        {/* `aria-labelledby`: the eye toggle inside this label must not join the input's name. */}
        <label>
          <span id={passwordLabelId}>{t("Password")}</span>
          <SecretInput label={t("Password")} toggleLabels={{ show: t("Show password"), hide: t("Hide password") }} aria-labelledby={passwordLabelId}
            autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error ? <div className="login-error">{error}</div> : null}
        <button disabled={busy}>{busy ? t("Signing in…") : t("Sign in")}</button>
      </form>
    </div>
  );
}
