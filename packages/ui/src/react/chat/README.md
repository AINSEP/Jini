# @jini-ai/chat-react

React bindings for a chat/artifact frontend, built on `@jini-ai/chat-core`'s framework-free
vocabulary: headless hooks for run streaming and conversation state, presentational components
(message list, composer, tool/todo cards, question forms), a slot system so a host can inject its
own project/analytics/i18n/annotation adapters, and `<JiniChatProvider>` — the one composition root
that wires a `ChatTransport` and those slots into context.

## Install

```sh
npm install @jini-ai/chat-react react react-dom
```

`react`/`react-dom` are peer dependencies (`^18.3.0 || ^19.0.0`). `@jini-ai/agentic`,
`@jini-ai/chat-core`, `@jini-ai/protocol`, and `@jini-ai/ui` are regular dependencies.

## What you get

- **Run streaming and conversation state** — `useRunStream(transport)` (low-level: start/stop one
  run against a `ChatTransport`) and `useConversation(options)` (history-aware: sends a message,
  tracks the in-flight run, appends the result). Supporting hooks: `useComposer` (draft text,
  attachments, mention popover), `useToolTimeline`, `useExtEventGroups`, `usePinnedTodos`,
  `useQuestionForms`, `useArtifactStream`, `useChatFabDrag`.
- **The `ChatTransport` port** — `ChatTransport`, `RunHandlers`, `StartRunInput`, `RunContext`,
  `FeedbackChange`, `OnFeedback` are re-exported from `@jini-ai/chat-core` (which owns them since
  2026-07-29) so existing imports from this package keep working; prefer importing them from
  `@jini-ai/chat-core` directly in new code.
- **Presentational components** — `MessageList`/`MessageRow`, `Composer`, `AttachmentTray`,
  `TodoCard`, `ToolCard`, `A2uiSurfaceCard`, `QuestionForm`/`QuestionsPanel`, `NextStepActions`,
  `Markdown`, `ExtEventErrorBoundary`, and `ChatFab` — a draggable floating action button that
  opens/closes a chat pane (click vs. drag disambiguated by pointer-move threshold, position
  clamped to the viewport). All ship unstyled semantic markup; a host supplies CSS (see
  [DOM structure](#dom-structure) below).
- **Composition root** — `<JiniChatProvider transport slots project analytics i18n
  artifactRegistry onFeedback>` plus `useJiniChatSlots()`/`useOnFeedback()` for a host's own
  wrapper components to reach the same slots without re-threading props. Lower-level context
  hooks: `useT`, `useI18n`, `useAnalytics`, `useProjectContext`, `useChatTransport`,
  `useArtifactRegistry`.
- **Slots** — the adapter interfaces a host injects for everything this package doesn't own:
  `ProjectContextValue` (file access), `ModelAgentPickerSlot`, `ComposerSlots`,
  `AttachmentTraySlot`, `AnnotationAdapter`, `FilePreviewSlot`, `AnalyticsAdapter`, `I18nAdapter`.
- **Renderer registries** — `registerToolRenderer`/`getToolRenderer`/`clearToolRenderers` and the
  `ext-event` equivalents, for a host to render its own tool/extension-event kinds.
- **`features/model-picker`** — an independent slice (`useModelPicker`, `<ModelPicker>`,
  `<CredentialStatusBadge>`, `defaultModelPickerPort`) depending only on `@jini-ai/protocol`.
- **`features/chat-pane`** — a higher-level, self-contained `<ChatPane>` and `<AgentRuntimePicker>`
  with their own hooks (`useChatPane`, `useChatPaneAgentControl`, `useChatPaneWorkingDirectory`,
  `useChatPaneRuntimeInventory`) and `CHAT_PANE_AGENT_TOOLS` for wiring an in-app agent-control
  surface.
- **Agent bridge** — `createFrontendSessionBridge`, the browser half of daemon-relayed frontend
  control; `createDomPageDriver`/`currentAgentPage` are re-exported here from
  `@jini-ai/agentic/dom` for pre-2026-07-26 import paths.

## Usage

```tsx
import { JiniChatProvider, MessageList, Composer, useComposer, useConversation } from '@jini-ai/chat-react';
import type { ChatTransport } from '@jini-ai/chat-core';

declare const transport: ChatTransport; // your SSE/fetch/WebSocket adapter

function ChatWindow() {
  const { messages, sendMessage, isStreaming, scrollIntent, acknowledgeScroll } = useConversation({ transport });
  const composer = useComposer();

  function handleSend() {
    void sendMessage(composer.draft, { attachments: composer.attachments });
    composer.reset();
  }

  return (
    <>
      <MessageList messages={messages} isStreaming={isStreaming} scrollIntent={scrollIntent} onScrolled={acknowledgeScroll} />
      <Composer composer={composer} onSend={handleSend} disabled={isStreaming} />
    </>
  );
}

export function App() {
  return (
    <JiniChatProvider transport={transport}>
      <ChatWindow />
    </JiniChatProvider>
  );
}
```

## What's swappable

Everything reachable through `JiniChatProviderProps`/`JiniChatSlots` is a real seam: `transport`
(any `ChatTransport` implementation), `project`, `analytics`, `i18n`, `artifactRegistry`, and each
`slots` entry (`modelPicker`, `composer`, `filePreview`, `annotation`, `attachmentTray`). Tool and
extension-event rendering are swappable per-name via `registerToolRenderer`/
`registerExtEventRenderer`. Fixed: the headless hooks' internal state-reduction logic and the
presentational components' DOM structure (only their CSS classes are meant to be restyled).

## DOM structure

Every component in this package renders unstyled semantic markup with `jini-*` BEM class names —
no CSS ships in `index.js`, and a host is expected to supply its own.

There is a structural-only reference stylesheet at
[`src/styles/reference.css`](./src/styles/reference.css) — `display`/`flex-direction`/`flex-wrap`/
`min-width: 0` rules for the parts of the DOM tree where a plain-HTML default (an inline element
that doesn't stack, an `inline-flex` that doesn't shrink to fit a narrow parent) would otherwise
render visibly broken rather than merely unstyled, including the two `.jini-chat-pane__controls`/
`.jini-chat-pane__drop-target` layout traps documented in `tovu-learnings.md` §7. **It is not
exported via `package.json` and not applied automatically** — it's a checked-in reference for a
host writing their own CSS against these class names, not something to `import` as-is. Read the
file's own comments for the reasoning behind each rule.

## Runtime

`jini.runtime: "browser"` — every component and hook assumes a DOM/React runtime.
ESM only — ships `"type": "module"` with no CommonJS `require` build.

## Provenance

See [source-map.md](./source-map.md) for per-file provenance and scope decisions. Apache-2.0,
inherited from Open Design — see the repo `NOTICE`.
