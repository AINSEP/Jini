import type { useAssistantDockState } from "./AssistantDock.state.hooks.js";
import type { useSelectedSkills, useComposerDiscoveryDraft } from "../../../screens/plugins/composer-skills.hooks.js";

export function useDockComposerInput({ onFolderDropCaptureReady, selectedSkills, discoveryDraft, skillInstall, hooks, deps }: {
  onFolderDropCaptureReady: Parameters<typeof useAssistantDockState>[0]["props"]["onFolderDropCaptureReady"];
  selectedSkills: ReturnType<typeof useSelectedSkills>;
  discoveryDraft: ReturnType<typeof useComposerDiscoveryDraft>;
  skillInstall: ReturnType<Parameters<typeof useAssistantDockState>[0]["hooks"]["useSkillInstall"]>;
  hooks: Parameters<typeof useAssistantDockState>[0]["hooks"];
  deps: Parameters<typeof useAssistantDockState>[0]["deps"];
}, _optional = {}) {
  const { useComposerVoiceInput, useAssistantPromptRequests, useSkillOnlySend, useDropBridge, useNativeFolderPicker } = hooks;
  const { nativeFolderPickerDeps } = deps;
  /**
   * Owns the `ChatPaneComposerHandle` a voice transcript is delivered through. No Jini change was
   * needed: `composerHandle` and its append-don't-replace `insertText` already existed — see
   * `use-composer-voice-input.hooks.ts`.
   */
  const voiceInput = useComposerVoiceInput();
  // A screen's drafted request (e.g. Sites' "From a live website") lands in the composer here.
  useAssistantPromptRequests(voiceInput.composerHandle);
  const skillOnlySend = useSkillOnlySend({ prompt: selectedSkills.skillOnlyPrompt, composerHandle: voiceInput.composerHandle, discovery: discoveryDraft });
  // SPEC-053: folder-drop-to-path + fs-files `custom` root wiring — reuses `voiceInput`'s own
  // `composerHandle` (the same "insert text into the composer" seam a voice transcript already goes
  // through) rather than owning a second ref to the same `ChatPaneComposerHandle`.
  const folderDrop = useDropBridge({ input: { composerHandle: voiceInput.composerHandle }, onReady: onFolderDropCaptureReady }, { proposeSkillFiles: skillInstall.proposeFiles, onSkillDropError: skillInstall.fail });
  // The composer's folder button: a picked path is handled exactly like a desktop folder drop; a
  // dialog that fails to open hides the button and falls back to the paste hint.
  const folderPicker = useNativeFolderPicker({ onPicked: folderDrop.insertFolderPath, onFailed: folderDrop.showPathHint }, nativeFolderPickerDeps);
  return { voiceInput, skillOnlySend, folderDrop, folderPicker };
}
