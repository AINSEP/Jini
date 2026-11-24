import { useEffect, useRef, useState } from "react";

/** The one operation the reveal flow needs from the host's site-transfer client. */
export interface ExportPasswordPort {
  revealSharePassword(required: { shareId: string }, optional?: Record<string, never>): Promise<{ password: string }>;
}

/** User-facing strings the host has already translated. */
export interface ExportPasswordLabels { revealFailed: string; copyFailed: string }

/** Fetch a password only in response to completion or Reveal. It never enters query caches.
 * Request generations discard late responses after dismissal, a new export, or unmount.
 * The host decides who may manage saved keys, how request failures read, and how text reaches the clipboard.
 * @returns Memory-only display state and explicit reveal/copy/dismiss actions.
 * @complexity O(1), one HTTP request per reveal and one clipboard operation per copy.
 */
export function useExportPassword({ port, labels, canManageSavedKeys, identity, copyText, describeError }: {
  port: ExportPasswordPort;
  labels: ExportPasswordLabels;
  canManageSavedKeys: boolean;
  identity: string;
  copyText: (required: { text: string }, optional?: Record<string, never>) => Promise<boolean>;
  describeError: (required: { e: unknown; fallback: string }, optional?: Record<string, never>) => string;
}, _optional = {}) {
  const [revealedPassword, setRevealedPassword] = useState<{ shareId: string; password: string } | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [revealingId, setRevealingId] = useState<string | null>(null);
  const [passwordCopied, setPasswordCopied] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    generation.current += 1;
    setRevealedPassword(null);
    setRevealingId(null);
    setPasswordCopied(false);
    setPasswordError(null);
    return () => { generation.current += 1; };
  }, [identity, canManageSavedKeys]);

  function hidePassword() {
    generation.current += 1;
    setRevealedPassword(null);
    setRevealingId(null);
    setPasswordCopied(false);
    setPasswordError(null);
  }

  async function revealPassword({ shareId }: { shareId: string }, _revealOptional = {}) {
    if (!canManageSavedKeys) return;
    hidePassword();
    const request = generation.current;
    setRevealingId(shareId);
    try {
      const result = await port.revealSharePassword({ shareId });
      if (request === generation.current) setRevealedPassword({ shareId, password: result.password });
    } catch (failure) {
      if (request === generation.current) setPasswordError(describeError({ e: failure, fallback: labels.revealFailed }));
    } finally {
      if (request === generation.current) setRevealingId(null);
    }
  }

  async function copyPassword() {
    if (!revealedPassword || !canManageSavedKeys) return;
    const request = generation.current;
    const copied = await copyText({ text: revealedPassword.password });
    if (request !== generation.current) return;
    setPasswordCopied(copied);
    if (!copied) setPasswordError(labels.copyFailed);
  }

  return { revealedPassword: canManageSavedKeys ? revealedPassword : null, passwordError, revealingId, passwordCopied, revealPassword, copyPassword, hidePassword };
}
