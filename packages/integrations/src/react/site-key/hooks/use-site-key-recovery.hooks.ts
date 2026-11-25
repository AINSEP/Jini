import { useState } from "react";
import type { AdminSiteKeyAffectedWebhook, AdminSiteKeyStartFreshPreview, AdminSiteKeyStatus, SiteKeyPort } from "@jini-ai/core/contracts/site/site-key";
import type { Translate } from "@jini-ai/core/text";
import type { SiteKeyGenerateFailure } from "./use-site-key.hooks.js";

type Empty = Record<string, never>;

/**
 * @file The Site key tab's last-resort recovery for a locked site (server:
 * `routes/system/site-key.ts`'s `import` / `start-fresh`): "Paste your old site key" and "Start
 * fresh" with one typed confirmation. All state and copy live here; `SiteKeyTab.tsx` only renders.
 *
 * The pasted token is cleared from state as soon as it is accepted. Refusals show the server's own
 * plain sentence (`body.detail`), which always says whether anything changed.
 */

/** The exact phrase "Start fresh" needs typed — the server checks the same string. */
export const START_FRESH_CONFIRMATION = "START FRESH";

export type SiteKeyRecoveryPort = Pick<SiteKeyPort, "importSiteKey" | "previewStartFresh" | "startFresh">;

export interface SiteKeyRecoveryController {
  siteKey: string;
  setSiteKey: (value: string) => void;
  unlocking: boolean;
  unlockError: string | null;
  /** No-op for an empty paste or while a request is in flight. */
  unlock: () => Promise<void>;
  /** `loading` while the preview is fetched; `confirm` once it is shown. */
  startFreshStep: "closed" | "loading" | "confirm";
  preview: AdminSiteKeyStartFreshPreview | null;
  openStartFresh: () => Promise<void>;
  cancelStartFresh: () => void;
  confirmText: string;
  setConfirmText: (value: string) => void;
  canConfirmStartFresh: boolean;
  startingFresh: boolean;
  startFreshError: string | null;
  /** No-op unless {@link canConfirmStartFresh}. */
  startFresh: () => Promise<void>;
  /** What the last successful recovery did, in plain words; `null` before one. */
  resultMessage: string | null;
  t: Translate;
}

/** Whether the tab should offer recovery: saved credentials need a key that is not in place.
 *  @complexity O(1). */
export function isSiteKeyLocked(
  { status, generateError }: {
    status: AdminSiteKeyStatus | undefined;
    generateError: SiteKeyGenerateFailure | null;
  },
  _optional: Record<string, never> = {},
): boolean {
  if (generateError?.kind === "locked") return true;
  return status?.state === "missing-with-data" || status?.state === "mismatch";
}

/** The status card's note for a locked site — replaces "A key is created automatically…", which
 *  is not true there (boot refuses to mint over saved credentials). `null` when not locked.
 *  @complexity O(1). */
export function siteKeyLockedNote(
  { status, generateError, t }: {
    status: AdminSiteKeyStatus | undefined;
    generateError: SiteKeyGenerateFailure | null;
    t: Translate;
  },
  _optional: Record<string, never> = {},
): string | null {
  return isSiteKeyLocked({ status, generateError }) ? t("Your credentials need their original site key — use the card above.") : null;
}

/** The server's own sentence for a refusal, else the shared fallback. @complexity O(1). */
function recoveryErrorMessage({ err, t, describeApiError, readApiRefusal, copy }: { err: unknown; t: Translate; describeApiError: (required: { e: unknown; fallback: string }, options?: Empty) => string;
    readApiRefusal: (required: { error: unknown }, options?: Empty) => { code: string | undefined; message: string; detail: string | undefined } | null;
    copy: { unknownError: string }; }, _optional: Record<string, never> = {}): string {
  const refusal = readApiRefusal({ error: err }, {});
  if (refusal && typeof refusal.detail === "string") return refusal.detail;
  return describeApiError({ e: err, fallback: t(copy.unknownError) });
}

function unlockedMessage({ resealed, t }: { resealed: number; t: Translate }, _optional: Record<string, never> = {}): string {
  const base = t("Unlocked. Your saved credentials work again.");
  return resealed > 0 ? `${base} ${t("{count} saved since were moved over.").replace("{count}", () => String(resealed))}` : base;
}

function startedFreshMessage(affectedWebhooks: readonly AdminSiteKeyAffectedWebhook[], t: Translate): string {
  const base = t("Done. Re-enter any credentials that were removed.");
  if (affectedWebhooks.length === 0) return base;
  const names = affectedWebhooks.map((webhook) => `${webhook.label} (${webhook.targetUrl})`).join(", ");
  return `${base} ${t("Update these webhooks' receivers with their new signing secret:")} ${names}.`;
}

/**
 * @param required - The recovery port, translator, and status refresh callback.
 * @param required.onRecovered - re-reads the tab's status after a successful recovery.
 */
export function useSiteKeyRecovery(
  { port, t, onRecovered, describeApiError, readApiRefusal, copy }: {
    port: SiteKeyRecoveryPort;
    t: Translate;
    onRecovered: (() => Promise<void> | void) | undefined;
    describeApiError: (required: { e: unknown; fallback: string }, options?: Empty) => string;
    readApiRefusal: (required: { error: unknown }, options?: Empty) => { code: string | undefined; message: string; detail: string | undefined } | null;
    copy: { unknownError: string };
  },
  _optional: Record<string, never> = {},
): SiteKeyRecoveryController {
  const [siteKey, setSiteKey] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [startFreshStep, setStartFreshStep] = useState<"closed" | "loading" | "confirm">("closed");
  const [preview, setPreview] = useState<AdminSiteKeyStartFreshPreview | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [startingFresh, setStartingFresh] = useState(false);
  const [startFreshError, setStartFreshError] = useState<string | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const canConfirmStartFresh = confirmText === START_FRESH_CONFIRMATION && !startingFresh;

  async function unlock(): Promise<void> {
    const pasted = siteKey.trim();
    if (pasted === "" || unlocking) return;
    setUnlocking(true);
    setUnlockError(null);
    try {
      const result = await port.importSiteKey({ siteKey: pasted });
      setSiteKey("");
      setResultMessage(unlockedMessage({ resealed: result.resealed, t }));
      await onRecovered?.();
    } catch (err) {
      setUnlockError(recoveryErrorMessage({ err, t, describeApiError, readApiRefusal, copy }));
    } finally {
      setUnlocking(false);
    }
  }

  const { openStartFresh, cancelStartFresh, startFresh } = createSiteKeyStartFreshActions({
    port, t, onRecovered, describeApiError, readApiRefusal, copy, confirmText, canConfirmStartFresh,
    setStartFreshStep, setStartFreshError, setPreview, setConfirmText, setStartingFresh, setResultMessage,
  });

  return {
    siteKey, setSiteKey, unlocking, unlockError, unlock,
    startFreshStep, preview, openStartFresh, cancelStartFresh, confirmText, setConfirmText, canConfirmStartFresh,
    startingFresh, startFreshError, startFresh, resultMessage, t,
  };
}


function createSiteKeyStartFreshActions({ port, t, onRecovered, describeApiError, readApiRefusal, copy, confirmText, canConfirmStartFresh,
  setStartFreshStep, setStartFreshError, setPreview, setConfirmText, setStartingFresh, setResultMessage }:
  Parameters<typeof useSiteKeyRecovery>[0] & Pick<SiteKeyRecoveryController, "confirmText" | "canConfirmStartFresh"> & {
    setStartFreshStep: (value: "closed" | "loading" | "confirm") => void;
    setStartFreshError: (value: string | null) => void;
    setPreview: (value: AdminSiteKeyStartFreshPreview | null) => void;
    setConfirmText: (value: string) => void;
    setStartingFresh: (value: boolean) => void;
    setResultMessage: (value: string | null) => void;
  }, _optional: Empty = {}) {
  async function openStartFresh(): Promise<void> {
    setStartFreshStep("loading");
    setStartFreshError(null);
    try {
      setPreview(await port.previewStartFresh());
    } catch (err) {
      setPreview(null);
      setStartFreshError(recoveryErrorMessage({ err, t, describeApiError, readApiRefusal, copy }));
    }
    setStartFreshStep("confirm");
  }

  function cancelStartFresh(): void {
    setStartFreshStep("closed");
    setConfirmText("");
    setStartFreshError(null);
  }

  async function startFresh(): Promise<void> {
    if (!canConfirmStartFresh) return;
    setStartingFresh(true);
    setStartFreshError(null);
    try {
      const result = await port.startFresh({ confirm: confirmText });
      setStartFreshStep("closed");
      setConfirmText("");
      setResultMessage(startedFreshMessage(result.affectedWebhooks, t));
      await onRecovered?.();
    } catch (err) {
      setStartFreshError(recoveryErrorMessage({ err, t, describeApiError, readApiRefusal, copy }));
    } finally {
      setStartingFresh(false);
    }
  }

  return { openStartFresh, cancelStartFresh, startFresh };
}
