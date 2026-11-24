import { useCallback, useMemo, useState } from "react";
import type { PublicAssistantSettings } from "@jini-ai/core/contracts/site/api-ai-assistant-api-types";
import { useCachedLoader, useFetchMutation, useFetchQuery } from "../../react/kit.js";

/**
 * @file The `AiAssistant` screen's own top-level state: the visitor-facing public on/off switch.
 *
 * Extracted verbatim — same state, same order, same effect, same error strings. This is
 * deliberately narrower than the whole screen: `AdminAssistantSwitch`, `AdminExecutionMode`, and
 * `VisitorCredentialForm` each own their own state and get their own hook file, per this feature's
 * "one hook file per component" convention (see the host's integrations feature hooks for the same
 * split applied to a smaller feature).
 *
 * `deps.port` is injected (see `AiAssistantPort` below) rather than reaching for `lib/api`'s
 * `api` directly — the same `useX(dependencies)` / `useWiredX()` split `redirects`/`widgets`/
 * `plugins`/`members`/`workspace` use. `useVisitorCredentialForm` (this folder, bound by the host's
 * visitor-credential-form dependencies hook) — the other hook this
 * screen composes — is NOT part of this conversion: it reaches a much larger `api` surface of its
 * own and is deliberately out of scope here. The host's error-to-copy rule arrives as `describeError`.
 */

/**
 * What `use-ai-assistant.hooks.ts` needs from the outside world, as an interface rather than
 * a direct `lib/api` import. Follows the `useX(dependencies)` / `useWiredX()` pair documented on
 * `assistant-chats-port.hooks.ts` (the canonical reference in this workspace) and the shape
 * `Jini redirects/SOURCE-RATIONALE.md` uses for a single-hook feature.
 *
 * Scoped to `useAiAssistant` only — `use-visitor-credential-form.hooks.ts` reaches a much larger
 * `api` surface of its own and is not part of this port.
 */
export interface AiAssistantPort {
  getAssistantSettings(): Promise<{ data: PublicAssistantSettings }>;
  setAssistantSettings(patch: Partial<PublicAssistantSettings>, optional?: Record<string, never>): Promise<{ data: PublicAssistantSettings }>;
}

export interface AiAssistantDependencies {
  port: AiAssistantPort;
  /** The host's error-to-copy rule; `fallback` is the English line used when the error says nothing usable. */
  describeError: (required: { e: unknown; fallback: string }, optional?: Record<string, never>) => string;
}

export interface AiAssistantController {
  settings: PublicAssistantSettings | null;
  loadError: string | null;
  saveError: string | null;
  saving: boolean;
  setPublicEnabled: (required: { publicEnabled: boolean }, optional?: Record<string, never>) => Promise<void>;
  setWidget: (input: { widget: "react" | "vanilla" }, options?: Record<string, never>) => Promise<void>;
}

/**
 * Loads and saves the public assistant settings through the injected port.
 * @complexity Time/space: O(1) — one query, one mutation.
 */
export function useAiAssistant({ port, describeError }: AiAssistantDependencies, _options: Record<string, never> = {}): AiAssistantController {
  const key = useMemo(() => ["ai-assistant", "settings"] as const, []);
  const fetchSettings = useCallback(async () => {
    try { return (await port.getAssistantSettings()).data; }
    catch (error) { throw new Error(describeError({ e: error, fallback: "failed to load AI assistant settings" })); }
  }, [port, describeError]);
  const query = useFetchQuery({ key, fetch: fetchSettings }, { staleTime: 0 });
  const loader = useCachedLoader({ key, fetch: fetchSettings }, { staleTime: 0 });
  const settings = query.data ?? null;
  const loadError = query.error?.message ?? null;
  const update = useFetchMutation({ run: ({ input }: { input: Partial<PublicAssistantSettings> }) => port.setAssistantSettings(input) }, { invalidates: [key] });
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function saveSettings(input: Partial<PublicAssistantSettings>, _options = {}) {
    setSaving(true);
    setSaveError(null);
    try {
      // The response, not `publicEnabled` — the server is the authority on what is now true, and a
      // rejected or partially-applied write must not leave this screen lying about it.
      const { data } = await update.mutate({ input });
      loader.replace({ value: data });
    } catch (e) {
      setSaveError(describeError({ e, fallback: "failed to save AI assistant settings" }));
    } finally {
      setSaving(false);
    }
  }

  const setPublicEnabled = ({ publicEnabled }: { publicEnabled: boolean }, _options: Record<string, never> = {}) => saveSettings({ publicEnabled });
  const setWidget = (input: { widget: "react" | "vanilla" }, options = {}) => saveSettings(input, options);
  return { settings, loadError, saveError, saving, setPublicEnabled, setWidget };
}
