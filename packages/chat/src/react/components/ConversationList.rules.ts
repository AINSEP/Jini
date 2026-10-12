/** Accessible name and optional native tooltip for the conversation switcher's icon-only trigger. */
export interface ConversationTriggerAttributes {
  'aria-label': string;
  title?: string;
}

/**
 * Resolves the switcher trigger's `aria-label` and native `title`. By default both name the active
 * conversation. A host that draws its own tooltip over the icon passes `nativeTitle: false`, so the
 * browser's dark native tip does not show on top of it, and `label` to rename the control (for
 * example "Chats") instead of stripping the attribute at runtime.
 * @param input.activeTitle - The active conversation's display title, or null/undefined when none.
 * @param input.t - The package translator.
 * @param options.label - Replaces the default accessible name (and the native title, when kept).
 * @param options.nativeTitle - `false` omits the native `title` attribute. Defaults to true.
 * @returns Props to spread onto the trigger button.
 * @complexity O(1).
 */
export function conversationTriggerAttributes(
  { activeTitle, t }: { activeTitle: string | null | undefined; t: (key: string) => string },
  { label, nativeTitle = true }: { label?: string | undefined; nativeTitle?: boolean | undefined } = {},
): ConversationTriggerAttributes {
  const ariaLabel = label ?? (activeTitle ? `${t('Conversations')} — ${activeTitle}` : t('Conversations'));
  if (!nativeTitle) return { 'aria-label': ariaLabel };
  return { 'aria-label': ariaLabel, title: label ?? activeTitle ?? t('Conversations') };
}
