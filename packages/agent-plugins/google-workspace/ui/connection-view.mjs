/**
 * @file What the connection panel says and offers for each connection state: pure functions from
 * the handler's panel view to text and buttons, with no DOM, so the honesty rules are testable.
 *
 * Exists because the wording IS the security property here: a revocation Google has not confirmed
 * must read "Disconnected locally; Google revocation pending" (never "revoked"), turning a product
 * off must not read like removing Google's permission, and a staged account switch must name the
 * new account before anything changes.
 */

export const REVOCATION_PENDING_TEXT = 'Disconnected locally; Google revocation pending';

const REVOCATION_TEXT = Object.freeze({
  confirmed: 'Disconnected. Google confirmed that this site\'s access to the account was removed.',
  pending: `${REVOCATION_PENDING_TEXT}. This site no longer uses this sign-in, but Google has not confirmed removing its access. Retry below, or remove this site's access yourself on your Google Account page.`,
  'not-needed': 'Disconnected. There was no Google access left to remove.',
});

/**
 * Shown while a switch is staged. The panel lists this plugin's form destinations (its delivery
 * bindings), and each stays with the account its spreadsheet was chosen with unless the person ticks it.
 */
export const SWITCH_NOTE = 'After the switch, the Google Workspace tools act as the new account. Form destinations stay with the account their spreadsheet was chosen with: tick the ones below that should deliver as the new account, and this site first checks that the new account can open each spreadsheet. A destination you leave unticked, or that the new account cannot open, keeps the old account: its deliveries fail with "Reconnect required" until you choose its spreadsheet again in Form destinations. Deliveries already queued keep the old account and are not sent again.';

/** What the panel says under the destination checkboxes: nothing is ticked until the person ticks it. */
export const REASSIGN_HINT = 'Move to the new account (nothing is moved unless you tick it):';

/**
 * The panel's own second step before a revocation (the sandboxed frame has no `confirm()`): it is
 * irreversible at Google, so one click must never do it.
 */
export const DISCONNECT_CONFIRM_TEXT = 'Disconnect and revoke? This site stops using this Google account at once and asks Google to remove its access. This cannot be undone: using Google Workspace again needs a new sign-in, and form deliveries fail until then.';

const button = (action, label) => ({ action, label });

const STATES = Object.freeze({
  disconnected: () => ({ heading: 'Not connected', tone: 'neutral', detail: 'Connect a Google account to let this site work with the spreadsheets you choose or create. It asks only for access to files you pick or it creates.', buttons: [button('connect', 'Connect Google account')] }),
  connected: ({ accountLabel }) => ({ heading: `Connected as ${accountLabel ?? 'a Google account'}`, tone: 'ok', detail: 'Reconnect keeps this account and its settings. Switch account asks you to confirm the new account before anything changes.', buttons: [button('reconnect', 'Reconnect'), button('switch', 'Switch account'), button('disconnect', 'Disconnect and revoke')] }),
  'reconnect-required': () => ({ heading: 'Reconnect required', tone: 'warn', detail: 'Google no longer accepts the saved sign-in. Form deliveries fail while it is like this and stay listed as failed; they are not sent again after you reconnect. Reconnect the same account so new submissions are delivered.', buttons: [button('reconnect', 'Reconnect'), button('disconnect', 'Disconnect and revoke')] }),
  'revocation-pending': () => ({ heading: REVOCATION_PENDING_TEXT, tone: 'warn', detail: REVOCATION_TEXT.pending, buttons: [button('retry-revocation', 'Retry Google revocation'), button('connect', 'Connect again')] }),
});

/**
 * Heading, status tone (the dot beside the heading), explanation and buttons for the connection; a
 * staged switch takes precedence.
 * @param {{ connection: { status: string, accountLabel?: string, pendingSwitchAccountLabel?: string } }} required
 * @returns {{ heading: string, tone: 'ok' | 'warn' | 'info' | 'neutral', detail: string, buttons: Array<{ action: string, label: string }> }}
 * @complexity O(1).
 */
export function connectionSummary(required, _optional = {}) {
  const { connection } = required;
  if (connection.pendingSwitchAccountLabel) {
    return {
      heading: `Switch to ${connection.pendingSwitchAccountLabel}?`,
      tone: 'info',
      detail: `Signed in now as ${connection.accountLabel ?? 'the current account'}. Nothing changes until you confirm. ${SWITCH_NOTE}`,
      buttons: [button('confirm-switch', `Use ${connection.pendingSwitchAccountLabel}`), button('cancel-switch', 'Keep the current account')],
    };
  }
  return (STATES[connection.status] ?? STATES.disconnected)(connection);
}

/**
 * The sentence after a disconnect, exactly as the host reported the remote outcome.
 * @param {{ revocation: 'confirmed' | 'pending' | 'not-needed' }} required
 * @returns {string} An unknown value reads as pending: never claim a revocation nobody confirmed.
 * @complexity O(1).
 */
export function revocationMessage(required, _optional = {}) {
  return REVOCATION_TEXT[required.revocation] ?? REVOCATION_TEXT.pending;
}

/**
 * The sentence after a confirmed switch: which destinations moved, which did not and why (the
 * plugin's fixed messages only), and that the rest still use the old account.
 * @param {{ reassignment: { moved: string[], failed: Array<{ formSlug: string, message: string }> }, destinations: Array<{ formSlug: string }> }} required
 * @returns {string}
 * @complexity O(d).
 */
export function reassignmentMessage(required, _optional = {}) {
  const { moved, failed } = required.reassignment;
  const kept = required.destinations.filter((entry) => !moved.includes(entry.formSlug)).map((entry) => entry.formSlug);
  return [
    'Switched account.',
    moved.length > 0 ? `Now delivering as the new account: ${moved.join(', ')}.` : null,
    ...failed.map((entry) => `Not moved, ${entry.formSlug}: ${entry.message}`),
    kept.length > 0 ? `Still using the old account (deliveries fail until you choose the spreadsheet again in Form destinations): ${kept.join(', ')}.` : null,
  ].filter(Boolean).join(' ');
}

/** A product's state line: on/off is a setting; Google's permission is a separate fact. @complexity O(1). */
function productNote(product, connected) {
  // Neutral wording: on a fresh install "off" is the normal starting point, not a failure.
  if (!product.enabled) return `Not in use. Turn it on to use ${product.label} in assistant tools and form deliveries. Turning it off later keeps the Google sign-in; deliveries already queued retry for about a day.`;
  if (!connected) return 'On. Connect a Google account to use it.';
  return product.granted ? 'On. Google has granted the permission it needs.' : 'On, but Google has not granted its permission yet. Grant it to use this product.';
}

/** The few words under a product's name; the full sentence (`productNote`) is its explanation. @complexity O(1). */
function productState(product, connected) {
  if (!product.enabled) return 'Not in use';
  if (!connected) return 'Needs a Google account';
  return product.granted ? 'Ready' : 'Needs Google permission';
}

/**
 * One row per product: label, short state, note, the on/off toggle and, when on but not granted,
 * the separate "Grant permission" sign-in.
 * @param {{ products: Array<{ id: string, label: string, enabled: boolean, granted: boolean }>, connection: { status: string } }} required
 * @returns {Array<{ id: string, label: string, state: string, note: string, enabled: boolean, toggleLabel: string, grant: boolean }>}
 * @complexity O(p).
 */
export function productRows(required, _optional = {}) {
  const connected = required.connection.status === 'connected';
  return required.products.map((product) => ({
    id: product.id, label: product.label, enabled: product.enabled, state: productState(product, connected), note: productNote(product, connected),
    toggleLabel: product.enabled ? `Turn ${product.label} off` : `Turn ${product.label} on`,
    grant: connected && product.enabled && !product.granted,
  }));
}
