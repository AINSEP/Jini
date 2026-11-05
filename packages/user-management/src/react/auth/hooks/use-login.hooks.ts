import type { Translate } from "@jini-ai/ui/panel-kit";
import { useState } from "react";

import type { AdminUser } from "../../models.js";
import type { LoginPort } from "../../ports.js";

export interface LoginHookProps {
  onLogin: (user: AdminUser) => void;
  port: LoginPort;
  translate: Translate;
}

export interface LoginOptions { initialUsername?: string | undefined }

export interface LoginController {
  mfa?: { code: string; setCode: (code: string) => void; cancel: () => void };
  username: string;
  setUsername: (username: string) => void;
  password: string;
  setPassword: (password: string) => void;
  error: string | null;
  busy: boolean;
  submit: (e: React.FormEvent) => Promise<void>;
}

export function useLogin({ onLogin, port, translate }: LoginHookProps, { initialUsername = "" }: LoginOptions = {}): LoginController {
  const [username, setUsername] = useState(initialUsername);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [code, setCode] = useState("");

  function cancel() { setPendingToken(null); setCode(""); setPassword(""); setError(null); }

  async function authenticate() {
    if (!pendingToken) return port.login({ username, password });
    if (!port.completeMfa) throw new Error(translate("Authenticator sign-in is unavailable. Cancel and try again."));
    return port.completeMfa({ pendingToken, code });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await authenticate();
      if ("mfaRequired" in result) {
        setPendingToken(result.pendingToken); setPassword(""); setCode("");
      } else {
        cancel(); onLogin(result.user);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : translate("login failed"));
    } finally {
      setBusy(false);
    }
  }

  return { username, setUsername, password, setPassword, error, busy, submit,
    ...(pendingToken ? { mfa: { code, setCode, cancel } } : {}) };
}

