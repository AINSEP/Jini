/**
 * @file One switch for whether the composer offers the push-to-talk mic button at all.
 *
 * Owner report, 2026-09-13 (Workspace chat screenshot): the mic button should not show. This is
 * NOT the "Disabled for now" tooltip `PushToTalkMicButton.tsx`'s own header already describes —
 * that copy sits on a button which still renders and is still functionally enabled wherever the
 * desktop shell makes it available. This flag goes one step further, at the one call site that
 * mounts the button (`AssistantDock.tsx`'s `composerSlots.footerLeadingAccessory`): when `false`,
 * the button is not mounted at all, so no disabled/enabled state is ever computed or shown.
 * Owner, 2026-10-30: in its place the footer briefly showed `VoiceInputPlaceholder`, a grayed mic
 * ("Voice input (coming soon)"); later that day the owner asked to hide it, so the slot is empty.
 * The placeholder component and its test are kept for when the mic comes back.
 *
 * Deliberately a flag, not a deletion — `PushToTalkMicButton`, its hooks, the desktop-side
 * host-injected voice bridge, and every test covering them are untouched, so restoring the button is
 * flipping this back to `true`, not re-implementing anything.
 */
export const VOICE_INPUT_ENABLED = false;
