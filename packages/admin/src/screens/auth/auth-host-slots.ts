import type { ChangeEvent, ComponentType, FormEvent } from "react";
import type { UserFacingError } from "@jini-ai/core";
import type { Translate } from "@jini-ai/core/text";
import type { AdminUser } from "@jini-ai/core/contracts/site/user-management-react";
import type { LoginPort } from "./hooks/login-port.hooks.js";

/**
 * @file The host collaborators the sign-in screens render or call, as feature-owned shapes. The
 * host binds each one (its secret input, its error notice with its own disclosure policy, its
 * passkey/recovery clients and the base login/recovery controller hooks) and passes it in; this
 * folder imports none of them.
 */

/** The host's password-style input with a reveal toggle. `data-*` attributes reach the `<input>`. */
export type AuthSecretInputProps = {
  readonly id: string; readonly label: string; readonly autoComplete: string; readonly value: string;
  readonly onChange: (event: ChangeEvent<HTMLInputElement>) => void; readonly locale?: string; readonly maxLength?: number;
} & { readonly [attribute: `data-${string}`]: string | undefined };

/** The host's error notice; the host decides how much of a failure an anonymous visitor sees. */
export interface AuthErrorNoticeProps { readonly failure: UserFacingError; readonly t: Translate; readonly className?: string }

/** The host's passkey sign-in button with its passkey client already bound. */
export interface AuthPasskeySignInProps {
  readonly pendingToken: string; readonly translate: Translate; readonly onComplete: () => void | Promise<void>;
}

/** The host's admin HTTP error class, as the login failure copy needs it. */
export interface LoginApiErrorPort {
  isApiError(e: unknown): e is { status: number; body?: { errorId?: unknown } | null | undefined };
}

/** What the base login controller hands back (username/password/MFA state and the submit handler). */
export interface BaseLoginController {
  mfa?: { pendingToken: string; code: string; setCode: (code: string) => void; cancel: () => void };
  username: string;
  setUsername: (username: string) => void;
  password: string;
  setPassword: (password: string) => void;
  error: string | null;
  busy: boolean;
  submit: (e: FormEvent) => Promise<void>;
}

/** The base login controller hook the host injects (its credential/MFA state machine). */
export type UseBaseLoginHook = (
  props: { onLogin: (user: AdminUser) => void; port: LoginPort; translate: Translate },
  options: { initialUsername?: string | undefined },
) => BaseLoginController;

/** The owner-recovery sign-in controller. */
export interface OwnerRecoverySignInController {
  code: string; setCode: (code: string) => void;
  password: string; setPassword: (password: string) => void;
  confirmation: string; setConfirmation: (confirmation: string) => void;
  failure: UserFacingError | null; busy: boolean; message: string;
  submit(event: FormEvent): Promise<void>;
}

/** The base recovery-code controller hook the host injects. */
export type UseRecoveryCodeSignInHook = (
  required: {
    recover: OwnerRecoverRequest; t: Translate;
    describeFailure: (required: { error: unknown; scope: "recover" | "issue" | "reset" }, optional?: Record<string, never>) => UserFacingError;
    copy: { readonly mismatch: string; readonly recovered: string; readonly reset: string };
  },
  optional: Record<string, never>,
) => OwnerRecoverySignInController;

/** The host's owner-recovery client's one call this screen makes. */
export type OwnerRecoverRequest = (input: { code: string; password: string }, optional?: Record<string, never>) => Promise<unknown>;

/** The host's recovery failure describer (its own error redaction and server-message policy). */
export type DescribeOwnerRecoveryFailure = (
  required: { error: unknown; message: string; action: string; step: string; t: Translate; secrets?: string[] },
  optional?: Record<string, never>,
) => UserFacingError;

/** Re-exported shape aliases so a binding can name the slot component types in one import. */
export type AuthSecretInput = ComponentType<AuthSecretInputProps>;
export type AuthErrorNotice = ComponentType<AuthErrorNoticeProps>;
export type AuthPasskeySignIn = ComponentType<AuthPasskeySignInProps>;
