import { describeErrorForLog } from "@jini-ai/core/model-facing-tool-errors";
import { useFetchQuery, useFetchMutation, useCachedLoader } from "../../../react/kit.js";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import type { WorkspacePort } from "./workspace-port.hooks.js";
import type { WorkspaceController } from "../Workspace.js";

/**
 * @file Everything the Workspace screen does, so `Workspace.tsx` is only markup.
 *
 * Extracted verbatim — same state, same order, same effect, same error handling. Naming follows
 * the host's settings-slice hook: `use-<thing>.hooks.ts`. Feature-local because nothing
 * outside the workspace screen needs it.
 *
 * `deps.port` is injected (see `./workspace-port.hooks`) rather than reaching for the host's API
 * client directly — the same `useX(dependencies)` / `useWiredX()` split `redirects`/`widgets`/
 * `plugins`/`members` use.
 *
 * `t` (2026-08-11, standing i18n rule — a component with a hook gets a BOUND `t` from that hook,
 * not its own `useAdminLocale()`/dictionary import): this hook already called `useAdminLocale()`
 * for its own error-string translations, so exposing that SAME already-resolved `locale` as a
 * bound `t` on the return value adds no new fetch — `Workspace.tsx` used to call `useAdminLocale()`
 * a second time, entirely redundant with the resolution this hook was already doing internally. No
 * raw `locale` needed: `Workspace.tsx`'s local `WorkspaceFormStatus` subcomponent still takes
 * `locale` as its own prop (carve-out — no hook file of its own), but the value it receives can now
 * come from the same `useWorkspace()` return rather than a second `useAdminLocale()` call.
 *
 * Since the move into this package the host resolves the locale (its `useAdminLocale()`) and passes
 * it in as `locale`, together with its workspace dictionary (`translate`) and its error-code copy
 * (`describeError`): all three are host copy or host I/O, so none of them is imported here.
 */

/** Translates one dictionary key for one locale — the host's workspace dictionary. */
export type WorkspaceTranslate = (required: { locale: string; key: string }) => string;

/** Turns a failed call into operator copy — the host's error-code overrides plus its default. */
export type WorkspaceErrorDescriber = (required: { e: unknown; fallback: string; locale: string }) => string;

export interface WorkspaceDependencies {
  port: WorkspacePort;
  /** The host's resolved admin locale. */
  locale: string;
  /** The host's workspace dictionary lookup; the returned `t` binds it to `locale`. */
  translate: WorkspaceTranslate;
  /** The host's error-message rule for load and save failures. */
  describeError: WorkspaceErrorDescriber;
}

/**
 * @complexity Time/space: O(1) per call — one workspace round trip on mount, one per save.
 */
export function useWorkspace({ port, locale, translate, describeError }: WorkspaceDependencies, _optional = {}): WorkspaceController {
  const boundT = (key: string): string => translate({ locale: locale, key: key });
  const key = useMemo(() => ["workspace", "current"] as const, []);
  const fetchWorkspace = useCallback(async () => {
    try { return (await port.getWorkspace()).workspace; }
    catch (error) { throw new Error(describeError({ e: error, fallback: translate({ locale, key: "failed to load workspace" }), locale })); }
  }, [port, locale, translate, describeError]);
  const query = useFetchQuery({ key, fetch: fetchWorkspace }, { staleTime: 0 });
  const loader = useCachedLoader({ key, fetch: fetchWorkspace }, { staleTime: 0 });
  const error = query.error?.message ?? null;
  const update = useFetchMutation({ run: ({ input }: { input: { name: string; slug: string } }) => port.updateWorkspace({ patch: input }) }, { invalidates: [["workspace"]] });

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const hydrated = useRef(false);
  const workspace = hydrated.current ? query.data ?? null : null;
  useEffect(() => {
    let cancelled = false;
    // Await this mount's read before enabling the form. Background invalidation updates workspace
    // truth, never the operator's rename draft after hydration.
    void loader.load().then(workspace => {
      if (cancelled || hydrated.current) return;
      hydrated.current = true;
      setName(workspace.name);
      setSlug(workspace.slug);
    }, () => { /* The reactive query exposes this read's error. */ })
      .catch((error: unknown) => console.error("[workspace] Could not apply the loaded settings", describeErrorForLog({ err: error })));
    return () => { cancelled = true; };
  }, [loader]);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const { workspace: updated } = await update.mutate({ input: { name, slug } });
      loader.replace({ value: updated });
      setSaved(true);
    } catch (e) {
      setSaveError(describeError({ e, fallback: translate({ locale: locale, key: "failed to save workspace" }), locale }));
    } finally {
      setSaving(false);
    }
  }

  return { workspace, error, name, setName, slug, setSlug, saving, saveError, saved, onSave, t: boundT, locale };
}
