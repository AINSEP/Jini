import type { FormDestinationAddress } from "../index.js";

/**
 * @file The receiver-key lifecycle for form destinations: look a scope's key up, reuse it on a
 * republish (moving its address only when the receiver's origin changed), save a freshly minted one
 * once the receiver has it, and enumerate every saved receiver to pull from. Storage is injected as
 * a {@link ReceiverKeyVault} so a host maps it onto its own credential store; the label prefix,
 * key generation and duplicate classification are injected too. The key is never written to HTML,
 * history, logs or errors.
 */

/** A saved receiver key as the vault resolves it: the origin a pull goes to, and the key itself. */
export interface ReceiverKeyRecord {
  readonly id: string;
  readonly baseUrl: string;
  readonly secret: string;
}

/** The credential-store operations the lifecycle needs. */
export interface ReceiverKeyVault {
  /** Labels of every saved credential in the workspace (metadata only; no key is opened). */
  readonly listLabels: (required: { readonly workspaceId: string }) => Promise<readonly string[]>;
  /** Opens one key by label, or `null` when none is saved. */
  readonly resolve: (required: { readonly workspaceId: string; readonly label: string }) => Promise<ReceiverKeyRecord | null>;
  /** Saves a new key under a label. */
  readonly create: (required: { readonly workspaceId: string; readonly label: string; readonly baseUrl: string; readonly secret: string }) => Promise<void>;
  /** Moves an existing key's address. */
  readonly updateBaseUrl: (required: { readonly workspaceId: string; readonly id: string; readonly baseUrl: string }) => Promise<void>;
  /** True when `error` is the vault's "that label already exists" failure (a concurrent first save). */
  readonly isDuplicateLabel: (error: unknown) => boolean;
}

/** The vault label for one scope's key. @complexity O(1). */
export function receiverKeyLabel({ labelPrefix, scope }: { labelPrefix: string; scope: string }, _optional = {}): string {
  return `${labelPrefix}${scope}`;
}

/**
 * The publish-side key. A first publish with forms mints a key and saves it once the receiver has
 * it; a republish reuses the key and moves its base URL when the receiver's origin changed (a rename).
 * @complexity One vault list per call, plus one open for an existing key.
 */
export async function resolveReceiverKey(
  required: { vault: ReceiverKeyVault; workspaceId: string; scope: string; labelPrefix: string; newSecret: () => string },
  _optional = {},
): Promise<{ readonly secret: string; readonly save: (required: { readonly url: string }) => Promise<void> }> {
  const { vault, workspaceId, scope, labelPrefix } = required;
  const label = receiverKeyLabel({ labelPrefix, scope });
  const existing = await vault.resolve({ workspaceId, label });
  if (existing) {
    return { secret: existing.secret, save: async ({ url }) => {
      const baseUrl = new URL(url).origin;
      if (baseUrl !== existing.baseUrl) await vault.updateBaseUrl({ workspaceId, id: existing.id, baseUrl });
    } };
  }
  const secret = required.newSecret();
  return { secret, save: async ({ url }) => {
    try { await vault.create({ workspaceId, label, baseUrl: new URL(url).origin, secret }); }
    // A concurrent publish saved its key first; the next publish installs that one everywhere.
    catch (error) { if (!vault.isDuplicateLabel(error)) throw error; }
  } };
}

/** Every saved receiver to pull from, optionally one scope's. Opens only the matching keys.
 * @complexity O(saved credentials) metadata plus one open per destination. */
export async function listReceiverKeys(
  required: { vault: ReceiverKeyVault; workspaceId: string; labelPrefix: string },
  optional: { scope?: string } = {},
): Promise<{ scope: string; destination: FormDestinationAddress }[]> {
  const { vault, workspaceId, labelPrefix } = required;
  const labels = (await vault.listLabels({ workspaceId }))
    .filter((label) => label.startsWith(labelPrefix) && (optional.scope === undefined || label === receiverKeyLabel({ labelPrefix, scope: optional.scope })));
  const found: { scope: string; destination: FormDestinationAddress }[] = [];
  for (const label of labels) {
    const resolved = await vault.resolve({ workspaceId, label });
    if (resolved) found.push({ scope: label.slice(labelPrefix.length), destination: { url: resolved.baseUrl, secret: resolved.secret } });
  }
  return found;
}
