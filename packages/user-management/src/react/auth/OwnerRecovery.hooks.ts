import { useState, type Dispatch, type FormEvent, type SetStateAction } from 'react';
import type { UserFacingError } from '@jini-ai/core';
import type { Translate } from '@jini-ai/core/text';

export interface OwnerRecoveryPorts {
  recover(required: { code: string; password: string }, optional?: Record<string, never>): Promise<unknown>;
  issue(required: { password: string; code?: string }, optional?: Record<string, never>): Promise<{ codes: string[] }>;
  reset(required: { password: string }, optional?: Record<string, never>): Promise<unknown>;
}

/** Host-resolved messages displayed without further translation. */
export interface OwnerRecoveryCopy {
  readonly mismatch: string;
  readonly recovered: string;
  readonly reset: string;
}

export type DescribeRecoveryFailure = (
  required: { error: unknown; scope: 'recover' | 'issue' | 'reset' },
  optional?: Record<string, never>,
) => UserFacingError;

type Setter<T> = Dispatch<SetStateAction<T>>;

export interface RecoveryCodeSignInController {
  code: string;
  setCode: Setter<string>;
  password: string;
  setPassword: Setter<string>;
  confirmation: string;
  setConfirmation: Setter<string>;
  failure: UserFacingError | null;
  busy: boolean;
  message: string;
  submit(event: FormEvent): Promise<void>;
}

export interface RecoveryKitController {
  password: string;
  setPassword: Setter<string>;
  code: string;
  setCode: Setter<string>;
  codes: string[];
  setCodes: Setter<string[]>;
  busy: boolean;
  error: UserFacingError | null;
  submit(event: FormEvent): Promise<void>;
}

export interface OwnerPasswordResetController {
  password: string;
  setPassword: Setter<string>;
  confirmation: string;
  setConfirmation: Setter<string>;
  busy: boolean;
  message: string;
  failure: UserFacingError | null;
  submit(event: FormEvent): Promise<void>;
}

/** Reset the owner password with a one-use recovery code. */
export function useRecoveryCodeSignIn(
  required: { recover: OwnerRecoveryPorts['recover']; describeFailure: DescribeRecoveryFailure; t: Translate; copy: OwnerRecoveryCopy },
  _optional: Record<string, never> = {},
): RecoveryCodeSignInController {
  const { recover, describeFailure, copy } = required;
  const [code, setCode] = useState(''), [password, setPassword] = useState(''), [confirmation, setConfirmation] = useState('');
  const [failure, setFailure] = useState<UserFacingError | null>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  async function recoverAccount() {
    try {
      await recover({ code: code.trim(), password });
      setMessage(copy.recovered);
    } catch (error) {
      setFailure(describeFailure({ error, scope: 'recover' }));
    } finally {
      // secrets are cleared in finally so a failed or successful attempt never leaves a password in component state
      setCode(''); setPassword(''); setConfirmation(''); setBusy(false);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password !== confirmation) { setMessage(copy.mismatch); return; }
    setBusy(true); setMessage(''); setFailure(null);
    await recoverAccount();
  }
  return { code, setCode, password, setPassword, confirmation, setConfirmation, failure, busy, message, submit };
}

/** Issue a fresh recovery kit after password proof. */
export function useRecoveryKit(
  required: { issue: OwnerRecoveryPorts['issue']; describeFailure: DescribeRecoveryFailure },
  _optional: Record<string, never> = {},
): RecoveryKitController {
  const { issue, describeFailure } = required;
  const [password, setPassword] = useState(''), [code, setCode] = useState(''), [codes, setCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState<UserFacingError | null>(null);
  async function issueCodes() {
    try {
      setCodes((await issue({ password, ...(code ? { code } : {}) })).codes);
    } catch (error) {
      setError(describeFailure({ error, scope: 'issue' }));
    } finally {
      setPassword(''); setCode(''); setBusy(false);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null); setCodes([]);
    await issueCodes();
  }
  return { password, setPassword, code, setCode, codes, setCodes, busy, error, submit };
}

/** Save the displayed codes through the host before clearing them from the view. */
export function createRecoveryKitDownload(
  required: {
    codes: readonly string[];
    dismiss: () => void;
    saveTextFile: (required: { text: string; filename: string }, optional?: Record<string, never>) => void;
    filename: string;
  },
  _optional: Record<string, never> = {},
): () => void {
  const { codes, dismiss, saveTextFile, filename } = required;
  return function download() {
    saveTextFile({ text: codes.join('\n') + '\n', filename });
    dismiss();
  };
}

/** Reset the owner's password using its restored owner session. */
export function useOwnerPasswordReset(
  required: { reset: OwnerRecoveryPorts['reset']; describeFailure: DescribeRecoveryFailure; t: Translate; copy: OwnerRecoveryCopy },
  _optional: Record<string, never> = {},
): OwnerPasswordResetController {
  const { reset, describeFailure, copy } = required;
  const [password, setPassword] = useState(''), [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [failure, setFailure] = useState<UserFacingError | null>(null);
  async function resetPassword() {
    try {
      await reset({ password });
      setMessage(copy.reset);
    } catch (error) {
      setFailure(describeFailure({ error, scope: 'reset' }));
    } finally {
      setPassword(''); setConfirmation(''); setBusy(false);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password !== confirmation) { setMessage(copy.mismatch); return; }
    setBusy(true); setMessage(''); setFailure(null);
    await resetPassword();
  }
  return { password, setPassword, confirmation, setConfirmation, busy, message, failure, submit };
}
