import { useCallback, useMemo, useState } from "react";
import type { AdminSiteKeyStatus, SiteKeyPort } from "@jini-ai/core/contracts/site/site-key";
import type { FetchQueryAdapter } from "@jini-ai/core/fetch";
import type { Translate } from "@jini-ai/core/text";

type Empty = Record<string, never>;

/**
 * @file The Site key tab's controller — status + reveal + generate, no update/delete/rotate
 * (see `SiteKeyTab.tsx`'s own header for why a rotate/replace flow is deliberately not built).
 *
 * ## Reveal is ONE mechanism, not two
 *
 * An earlier brief had generate show its new value once, at creation, with a "will not be shown
 * again" warning, and every other read stay fingerprint-only. The owner superseded that ("i want
 * that token to be visible to admins or else when it breaks they have no idea whats going on"),
 * so this controller does not build a second, generate-specific reveal path — `reveal()` is the
 * one way this tab ever shows a key value, usable at any time a key is active, including
 * immediately after a successful `generate()` (which does NOT auto-populate `revealedHex` — the
 * operator clicks Reveal same as any other time, consistent with "never shown on page load, only
 * behind an explicit action" applying uniformly rather than making creation a special case).
 *
 * `revealedHex` is local state, not derived from `status`: the value exists nowhere else in this
 * controller (`AdminSiteKeyStatus` never carries it — see that type's own doc), and clearing it
 * (`hideRevealed`) only ever removes it from THIS state, never from the server.
 */

export interface SiteKeyController {
  /** `undefined` until the first status read settles (success or failure). */
  status: AdminSiteKeyStatus | undefined;
  loadError: string | null;
  revealing: boolean;
  revealError: string | null;
  /** The revealed key value, or `null` before the first reveal / after {@link hideRevealed}. */
  revealedHex: string | null;
  /** No-op when nothing is active to reveal. */
  reveal: () => Promise<void>;
  hideRevealed: () => void;
  generating: boolean;
  /** The classified failure (see {@link SiteKeyGenerateFailure}) — `SiteKeyTab.tsx` renders the
   *  server's own sentence for `"locked"`/`"refused"`, fixed copy for `"already-exists"`, and wraps
   *  `detail` in "Couldn't generate a key: …" only for `"generic"`. Kept as the classification
   *  itself, not a pre-rendered string, so a known refusal never reads as a genuine failure. */
  generateError: SiteKeyGenerateFailure | null;
  /** No-op (and leaves `generateError` alone) unless `status.source === "none"` — the tab's own
   *  Generate control is hidden outside that state (sol packet-3 finding 3-1), this is a second,
   *  defensive guard against a stale click. */
  generate: () => Promise<void>;
  /** Re-reads the status (after a recovery); clears a stale generate refusal. */
  refresh: () => Promise<void>;
  t: Translate;
}

/** Classifies a rejected generate call against the 409 codes `POST .../generate` sends
 *  (`lib/api.ts`'s `generateSiteKey` doc) — same "check `e.code ?? e.message`" shape
 *  `rules.ts`'s `classifyAccessTokenSubmitError` documents for Tier 1, reimplemented locally
 *  rather than imported: this tab has no other reason to depend on that file's provider-catalog
 *  tables.
 *  - `locked`: saved credentials need a key that is not here (`KEY_DEPENDENT_DATA`, `KEY_MISMATCH`)
 *    — the tab offers the recovery screen.
 *  - `refused`: nothing was changed for another reason (`KEY_INVALID`, `SITE_META_UNREADABLE`).
 *  - `already-exists`: production only, a key file appeared mid-request.
 *  `detail` is the server's own plain-words sentence (`body.detail`). @complexity O(1). */
export type SiteKeyGenerateFailure =
  | { kind: "locked"; code: "KEY_DEPENDENT_DATA" | "KEY_MISMATCH"; detail: string }
  | { kind: "refused"; code: "KEY_INVALID" | "SITE_META_UNREADABLE"; detail: string }
  | { kind: "already-exists" }
  | { kind: "generic"; detail: string };

/** Keep the server's public detail when present, including an intentionally empty string. */
function siteKeyGenerateDetail({ error, refusal, t, describeApiError, copy }: {
  error: unknown;
  refusal: { detail: string | undefined };
  t: Translate;
  describeApiError: Parameters<typeof classifySiteKeyGenerateError>[0]["describeApiError"];
  copy: { unknownError: string };
}): string {
  return typeof refusal.detail === "string" ? refusal.detail : describeApiError({ e: error, fallback: t(copy.unknownError) });
}

export function classifySiteKeyGenerateError({ e, t, describeApiError, readApiRefusal, copy }: { e: unknown; t: Translate; describeApiError: (required: { e: unknown; fallback: string }, options?: Empty) => string;
    readApiRefusal: (required: { error: unknown }, options?: Empty) => { code: string | undefined; message: string; detail: string | undefined } | null;
    copy: { unknownError: string }; }, _optional: Record<string, never> = {}): SiteKeyGenerateFailure {
  const refusal = readApiRefusal({ error: e }, {});
  if (!refusal) return { kind: "generic", detail: describeApiError({ e, fallback: t(copy.unknownError) }) };
  const marker = refusal.code ?? refusal.message;
  const detail = siteKeyGenerateDetail({ error: e, refusal, t, describeApiError, copy });
  if (marker === "KEY_DEPENDENT_DATA" || marker === "KEY_MISMATCH") return { kind: "locked", code: marker, detail };
  if (marker === "KEY_INVALID" || marker === "SITE_META_UNREADABLE") return { kind: "refused", code: marker, detail };
  if (marker === "ALREADY_EXISTS") return { kind: "already-exists" };
  return { kind: "generic", detail: describeApiError({ e, fallback: t(copy.unknownError) }) };
}

export function useSiteKey({ port, t, locale, queryHooks: { useFetchQuery, useFetchMutation, useCachedLoader }, describeApiError, readApiRefusal, copy }: {
    port: SiteKeyPort; t: Translate; locale: string;
    queryHooks: Pick<FetchQueryAdapter, "useFetchQuery" | "useFetchMutation" | "useCachedLoader">;
    describeApiError: (required: { e: unknown; fallback: string }, options?: Empty) => string;
    readApiRefusal: (required: { error: unknown }, options?: Empty) => { code: string | undefined; message: string; detail: string | undefined } | null;
    copy: {
      siteKeyLoadErrorMessage: (required: { locale: string; error: string }, options?: Empty) => string;
      siteKeyRevealErrorMessage: (required: { locale: string; error: string }, options?: Empty) => string;
      unknownError: string;
    };
  }, _optional: Record<string, never> = {}): SiteKeyController {
  const { siteKeyLoadErrorMessage, unknownError: UNKNOWN_ERROR } = copy;
  const key = useMemo(() => ["site-key", "status"] as const, []);
  const fetchStatus = useCallback(async () => {
    try { return await port.status(); }
    catch (error) { throw new Error(siteKeyLoadErrorMessage({ locale, error: describeApiError({ e: error, fallback: t(UNKNOWN_ERROR) }) })); }
  }, [port, locale, t]);
  const query = useFetchQuery({ key, fetch: fetchStatus }, { staleTime: 0 });
  const loader = useCachedLoader({ key, fetch: fetchStatus }, { staleTime: 0 });
  const status = query.data;
  const loadError = query.error?.message ?? null;
  const generateKey = useFetchMutation({ run: () => port.generate() }, { invalidates: [["site-key"]] });
  const [revealing, setRevealing] = useState(false);
  const [revealError, setRevealError] = useState<string | null>(null);
  const [revealedHex, setRevealedHex] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<SiteKeyGenerateFailure | null>(null);

  const { reveal, hideRevealed } = createSiteKeyRevealActions({ status, revealing, port, locale, t, copy, describeApiError, setRevealing, setRevealError, setRevealedHex });

  async function generate(): Promise<void> {
    if (status?.source !== "none" || generating) return;
    setGenerating(true);
    setGenerateError(null);
    try {
      const result = await generateKey.mutate({ input: {} });
      // Every success (`already-active`, `recovered`, `created`) leaves a key that matches the
      // `.site-meta.json` stamp — the server refuses with a 409 rather than leave a mismatch.
      loader.replace({ value: { active: true, source: "file", fingerprint: result.fingerprint, keyFilePath: result.keyFilePath, runtimeMode: result.runtimeMode, state: "active" } });
    } catch (err) {
      setGenerateError(classifySiteKeyGenerateError({ e: err, t, describeApiError, readApiRefusal, copy }));
    } finally {
      setGenerating(false);
    }
  }

  async function refresh(): Promise<void> {
    query.refetch();
    try {
      await loader.load();
      setGenerateError(null);
      setRevealedHex(null);
    } catch { /* The shared status query owns the existing load-error channel. */ }
  }

  return { status, loadError, revealing, revealError, revealedHex, reveal, hideRevealed, generating, generateError, generate, refresh, t };
}


function createSiteKeyRevealActions({ status, revealing, port, locale, t, copy, describeApiError, setRevealing, setRevealError, setRevealedHex }:
  Pick<SiteKeyController, "status" | "revealing" | "t"> &
  Pick<Parameters<typeof useSiteKey>[0], "port" | "locale" | "copy" | "describeApiError"> & {
    setRevealing: (value: boolean) => void;
    setRevealError: (value: string | null) => void;
    setRevealedHex: (value: string | null) => void;
  }, _optional: Empty = {}) {
  const { siteKeyRevealErrorMessage, unknownError: UNKNOWN_ERROR } = copy;
  async function reveal(): Promise<void> {
    if (!status?.active || revealing) return;
    setRevealing(true);
    setRevealError(null);
    try {
      const result = await port.reveal();
      if (result.hex) setRevealedHex(result.hex);
    } catch (err) {
      setRevealError(siteKeyRevealErrorMessage({ locale, error: describeApiError({ e: err, fallback: t(UNKNOWN_ERROR) }) }));
    } finally {
      setRevealing(false);
    }
  }

  function hideRevealed(): void {
    setRevealedHex(null);
  }

  return { reveal, hideRevealed };
}
