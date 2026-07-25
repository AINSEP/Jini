import { describe, expect, it } from 'vitest';
import * as barrel from '../index.js';

/**
 * `src/index.ts` is a pure re-export barrel (`export * from './x.js'` plus a
 * handful of named re-exports) — no logic of its own. Importing it directly
 * (rather than each submodule) is the only way to execute its own statements
 * under coverage, so this smoke test asserts every named export the barrel
 * promises is actually present and of the expected kind. It is a thin test,
 * deliberately: it exists to execute the barrel's own re-export statements
 * for coverage purposes, not to re-verify behavior already covered by each
 * submodule's own test file.
 */
describe('index barrel', () => {
  it('re-exports the runtime hooks', () => {
    expect(typeof barrel.useRunStream).toBe('function');
    expect(typeof barrel.useConversation).toBe('function');
    expect(typeof barrel.useComposer).toBe('function');
    expect(typeof barrel.useToolTimeline).toBe('function');
    expect(typeof barrel.usePinnedTodos).toBe('function');
    expect(typeof barrel.useQuestionForms).toBe('function');
    expect(typeof barrel.useArtifactStream).toBe('function');
  });

  it('re-exports the context accessor hooks', () => {
    expect(typeof barrel.useT).toBe('function');
    expect(typeof barrel.useI18n).toBe('function');
    expect(typeof barrel.useAnalytics).toBe('function');
    expect(typeof barrel.useProjectContext).toBe('function');
    expect(typeof barrel.useChatTransport).toBe('function');
    expect(typeof barrel.useArtifactRegistry).toBe('function');
  });

  it('re-exports the presentational components', () => {
    expect(typeof barrel.TodoCard).toBe('function');
    expect(typeof barrel.ToolCard).toBe('function');
    expect(typeof barrel.QuestionForm).toBe('object'); // forwardRef component
    expect(typeof barrel.QuestionsPanel).toBe('function');
    expect(typeof barrel.NextStepActions).toBe('function');
    expect(typeof barrel.Markdown).toBe('function');
    expect(typeof barrel.MessageRow).toBe('function');
    expect(typeof barrel.MessageList).toBe('function');
    expect(typeof barrel.Composer).toBe('function');
    expect(typeof barrel.AttachmentTray).toBe('function');
  });

  it('re-exports the composition root and its hooks', () => {
    expect(typeof barrel.JiniChatProvider).toBe('function');
    expect(typeof barrel.useJiniChatSlots).toBe('function');
    expect(typeof barrel.useOnFeedback).toBe('function');
  });

  it('re-exports the tool-renderer registry functions', () => {
    expect(typeof barrel.registerToolRenderer).toBe('function');
    expect(typeof barrel.getToolRenderer).toBe('function');
    expect(typeof barrel.clearToolRenderers).toBe('function');
  });

  it('re-exports the RendererRegistry class', () => {
    expect(typeof barrel.RendererRegistry).toBe('function');
    expect(new barrel.RendererRegistry().list()).toEqual([]);
  });

  it('re-exports the model-picker feature', () => {
    expect(typeof barrel.useModelPicker).toBe('function');
    expect(typeof barrel.ModelPicker).toBe('function');
    expect(typeof barrel.CredentialStatusBadge).toBe('function');
    expect(typeof barrel.groupModelsByProvider).toBe('function');
    expect(typeof barrel.filterModelGroups).toBe('function');
    expect(typeof barrel.findSelectedModel).toBe('function');
    expect(typeof barrel.isCustomModelId).toBe('function');
    expect(typeof barrel.firstAvailableModelId).toBe('function');
    expect(typeof barrel.modelSubtitle).toBe('function');
    expect(typeof barrel.matchesModelQuery).toBe('function');
    expect(barrel.defaultModelPickerPort).toEqual({});
    expect(barrel.DEFAULT_MIN_SEARCHABLE_OPTIONS).toBe(8);
    expect(barrel.CREDENTIAL_STATUS_SORT_PRIORITY).toEqual({ configured: 0, available: 1, unconfigured: 2 });
  });

  it('re-exports the self-contained chat-pane feature', () => {
    expect(typeof barrel.ChatPane).toBe('function');
    expect(typeof barrel.AgentRuntimePicker).toBe('function');
    expect(typeof barrel.useChatPane).toBe('function');
    expect(typeof barrel.useChatPaneRuntimeInventory).toBe('function');
    expect(typeof barrel.useChatPaneWorkingDirectory).toBe('function');
    expect(typeof barrel.defaultChatPaneSelection).toBe('function');
    expect(typeof barrel.resolveChatPaneSelection).toBe('function');
    expect(typeof barrel.orderChatPaneAgents).toBe('function');
  });
});
