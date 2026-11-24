import type { AdminExecutionCredential, AdminExecutionCredentialPatch } from "@jini-ai/core/contracts/site/api-ai-assistant-api-types";

/**
 * @file What `useAdminExecutionCredential` needs from the outside world, as an interface rather than
 * a direct import of the host's `lib/execution-settings`.
 *
 * Follows the `useX(dependencies)` / `useWiredX()` pair documented on `assistant-chats-port.hooks.ts`
 * (the canonical reference in this workspace) and already applied to `features/redirects` and
 * `features/pages`' `usePageEditor`: this file declares, `admin-execution-credential-dependencies
 * .hooks.ts` (in the host) binds the real implementation, and nothing else reaches the host's `lib/execution-settings`'s
 * `loadAdminExecutionCredential`/`saveAdminExecutionCredential` for this hook.
 *
 * ## What is deliberately NOT in this port
 *
 * - `hasUsableAdminKey` — a pure rule with no I/O; per the pattern a hook imports rules directly
 *   rather than having them injected (same reasoning `assistant-chats-port.hooks.ts` gives for
 *   `persistableMessages`).
 * - `readLegacyLocalCredential`/`clearLegacyLocalCredential` — real `localStorage` I/O, but jsdom
 *   (this repo's test environment) already provides a working, in-memory `localStorage`, and the
 *   hook's existing test suite already exercises both functions directly with zero mocking pain.
 *   Injecting them would add a seam with no testability gap to close.
 * - The `settings-refresh-bus` publish/subscribe calls — `settings-refresh-bus.ts` ships its own
 *   dedicated test-reset export (`resetSettingsRefreshBus`), and the hook's existing tests already
 *   call the real bus directly (`publishSettingsRefresh`) with no module mock — the same testability
 *   the `useX`/`useWiredX` split exists to provide, already met by a different, purpose-built seam.
 *
 * What DOES belong here: the two functions that reach `api.getAdminExecutionCredential`/
 * `api.setAdminExecutionCredential` under the hood (`lib/execution-settings.ts`) — the hook's
 * existing test file has to `vi.mock("../../lib/api", ...)` to cover them, which is exactly the
 * module-mocking this pattern replaces with an injected fake.
 */
export interface AdminExecutionCredentialPort {
  loadAdminExecutionCredential(): Promise<AdminExecutionCredential>;
  saveAdminExecutionCredential(required: { patch: AdminExecutionCredentialPatch }): Promise<AdminExecutionCredential>;
}

/** The "nothing stored yet" server view — matches the host `lib/api.ts`'s `AdminExecutionCredential` shape
 *  for a row that has never been written. Exported so tests can start from it explicitly rather than
 *  re-typing the same object literal, mirroring the test file's own pre-conversion `unsetView()`. */
export const UNSET_ADMIN_EXECUTION_CREDENTIAL: AdminExecutionCredential = {
  isSet: false,
  masked: null,
  protocol: "anthropic",
  providerId: null,
  baseUrl: null,
  model: null,
  maxTokens: null,
  updatedAt: null,
};

/** Seed state for {@link createFakeAdminExecutionCredentialPort}. */
export interface FakeAdminExecutionCredentialPortOptions {
  /** What `loadAdminExecutionCredential()` returns until a save overwrites it. Defaults to nothing
   *  stored. */
  stored?: AdminExecutionCredential;
  /**
   * Called on every `saveAdminExecutionCredential`, before the default merge runs. Return a full
   * {@link AdminExecutionCredential} to replace the default merge outright (e.g. a custom `masked`
   * value), or throw to simulate a rejected save — the fake does not catch it, matching a real
   * `api.setAdminExecutionCredential` rejection.
   */
  onSave?: (patch: AdminExecutionCredentialPatch) => AdminExecutionCredential | undefined;
}

/**
 * An in-memory {@link AdminExecutionCredentialPort} for tests — the fake that lets a test describe
 * "nothing is stored yet" or "the save fails" directly, instead of `vi.mock`-ing `lib/api`. Shipped
 * beside the port it fakes per the pattern's "every port gets a fake" rule (see the host's
 * `assistant-chats-dependencies.hooks.ts`); the host's `admin-execution-credential-dependencies.hooks.ts`
 * keeps only the real binding.
 */
export function createFakeAdminExecutionCredentialPort(
  options: FakeAdminExecutionCredentialPortOptions = {},
): AdminExecutionCredentialPort & {
  /** The credential view as currently held by the fake, after any save made through the port. */
  readonly current: AdminExecutionCredential;
  /** Every patch this fake received, in call order. */
  readonly saveCalls: AdminExecutionCredentialPatch[];
} {
  let stored = options.stored ?? UNSET_ADMIN_EXECUTION_CREDENTIAL;
  const saveCalls: AdminExecutionCredentialPatch[] = [];

  return {
    get current() {
      return stored;
    },
    saveCalls,

    async loadAdminExecutionCredential() {
      return stored;
    },

    async saveAdminExecutionCredential({ patch }) {
      saveCalls.push(patch);
      const overridden = options.onSave?.(patch);
      if (overridden) {
        stored = overridden;
        return stored;
      }
      stored = {
        isSet: true,
        masked: patch.apiKey ? `••••${patch.apiKey.slice(-4)}` : stored.masked,
        protocol: patch.protocol ?? stored.protocol,
        providerId: patch.providerId !== undefined ? patch.providerId : stored.providerId,
        baseUrl: patch.baseUrl ?? stored.baseUrl,
        model: patch.model ?? stored.model,
        maxTokens: patch.maxTokens ?? stored.maxTokens,
        updatedAt: new Date(0).toISOString(),
      };
      return stored;
    },
  };
}
