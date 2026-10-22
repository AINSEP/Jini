import type { FormEvent } from 'react';
import type { SettingsSectionProps } from '../components/SettingsSection.js';
import { useWiredCommentSettings } from './use-comment-settings.hooks.js';
import { useCommentsTranslation } from './CommentsPorts.hooks.js';

/**
 * Resolves the injected hook prop to the real wired hook when a caller passes none. Pulled into its
 * own function, the same `??`-avoidance idiom `MenuEditor.tsx`'s `orEmpty`/`CollectionEntryEditor
 * .tsx`'s `resolveCollectionEntryEditorHook` use: `SettingsSection` was already sitting at the 9/9
 * complexity ceiling, and ESLint's cyclomatic-complexity rule counts a default value or `??` inside
 * a function's OWN body as one of that function's own branches — a call out to a separately-scoped
 * resolver does not.
 */
function resolveCommentSettingsHook(
  override: typeof useWiredCommentSettings | undefined
): typeof useWiredCommentSettings {
  return override ?? useWiredCommentSettings;
}


export function useSettingsSection(props: SettingsSectionProps, _optional: Record<string, never> = {}) {
  const contextT = useCommentsTranslation();
  const useSettings = resolveCommentSettingsHook(props.useCommentSettingsHook);
  const settings = useSettings({ canConfigure: props.canConfigure });
  return { ...settings, t: props.t ?? contextT,
    onSubmit: (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void settings.save(new FormData(event.currentTarget)); } };
}
