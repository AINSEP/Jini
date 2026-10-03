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

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { user } = await port.login({ username, password });
      onLogin(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : translate("login failed"));
    } finally {
      setBusy(false);
    }
  }

  return { username, setUsername, password, setPassword, error, busy, submit };
}

