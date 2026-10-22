Spec ID: SPEC-JINI-CHAT-UI
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:69fa7a217a0309adab4afaaf574926fdc0d72d6a67dd66fa8b203c899de6691c
spec_mode: reverse_spec


# UI contract: @jini-ai/chat

## Public components

Components are React calls with one props object, `Component(props: ComponentProps)`, returning rendered React elements (or null where the source permits). Required and optional fields are defined by the public named props types; React's props convention is retained before the args refactor.

| Component / props type | Consumer inputs and behavior |
|---|---|
| `JiniChatProvider` / `JiniChatProviderProps` | Required transport and children; optional project, analytics, i18n, artifactRegistry, slots, onFeedback; publishes contexts |
| `ChatPane` / `ChatPaneProps` | Required transport; optional agents/runtime/directory access, initialMessages/conversationId, upload callback, context builder, selection callbacks, agent control, accessories and composer handle; composed message/composer/runtime UI |
| `AgentRuntimePicker` / `AgentRuntimePickerProps` | Agent inventory, selection and callback; availability/auth/model/reasoning UI; canonical `/react/chat-pane` export |
| `MessageList` / `MessageListProps` | Messages and stream/scroll state/callbacks; retains user scroll intent |
| `MessageRow` / `MessageRowProps` | Message plus runtime/render context; ordered prose/tool/extension blocks |
| `Composer` / `ComposerProps` | Controlled draft/send/cancel and optional attachments/slots; keyboard composition and upload state |
| `AttachmentTray` / `AttachmentTrayProps` | Attachments, remove callback, optional preview/upload state; removable file/image chips |
| `ToolCard` / `ToolCardProps` | Tool use/result and run state; custom renderer, family renderer, then generic fallback |
| `TodoCard` / `TodoCardProps` | Todo items/input and status; progress display |
| `QuestionForm` / `QuestionFormProps` | Form, submission callbacks and optional submitted answers; forwarded `QuestionFormHandle` for focus/submission; file callback where supplied |
| `QuestionsPanel` / `QuestionsPanelProps` | Parsed question forms and answer callbacks; question navigation |
| `NextStepActions` / `NextStepActionsProps` | Action list/callbacks; suggested follow-up choices |
| `Markdown` / `MarkdownProps` | Markdown content and optional classes; prose renderer |
| `ConversationList` / `ConversationListProps` | conversations, activeConversationId, onSelect/onCreate/onDelete/onRename required; optional onSearch, confirmDelete, createDisabled, emptyState |
| `ChatFab` / `ChatFabProps` | open/onToggle required; label defaults to `chat`; draggable toggle |
| `A2uiSurfaceCard` / `A2uiSurfaceCardProps` | Extension events and optional agent-action callback; A2UI surface renderer |
| `McpUiSurfaceCard` / `McpUiSurfaceCardProps` | Extension events and required sandboxProxyUrl; optional onToolCall/onOpenLink/maxHeight and correlated call/runStreaming |
| `ExtEventErrorBoundary` / `ExtEventErrorBoundaryProps` | Child renderer and fallback/reset information; contains renderer errors |

Pane components/helpers are also compatibility-exported from `/react`; new pane composition imports use `/react/chat-pane`. No public embed widget or model-picker entry point exists in this manifest snapshot.

## Slots and ports

`JiniChatSlots` carries modelPicker, composer, filePreview, annotation and attachmentTray. Provider slots are available through useJiniChatSlots; presentational components receive their own slot props explicitly. A provider alone does not inject every slot into every component.

ComposerSlots carries plusMenuItems, discoveryGroups/onDiscoverySelect, mentionSources, leadingAccessories, footerAccessories, footerLeadingAccessory, onAttach and annotationAdapter. Mention sources supply search(query) and optional trigger; discovery items describe insertion/command/arguments and optional confirmation. Hosts supply the actual discovery actions.

The model-picker slot receives value/onChange/agents; the file-preview slot renders a file and optional close callback. Annotation adapters convert host selections into attachments. ProjectContextValue supplies host file/context information. I18nAdapter supplies `{t(key, vars?), locale}`; absent i18n is passthrough and absent analytics is a no-op.

ToolRenderer callbacks run during ToolCard render and must be hook-free; return a React component element when hooks are needed. Null/undefined/false defers to built-in fallback. Ext renderers receive grouped events and correlation/render context. registerMcpUiSurfaceRenderer requires sandboxProxyUrl and returns an unregister handle.

## Theming and accessibility

The package does not auto-import CSS. `/react/styles/reference.css` is an exported, optional structural stylesheet against `jini-*` classes. It defines layout and animation, with no public `--jini-*` theming-variable contract. Colors, typography, spacing and visual tokens are supplied by the host stylesheet. Pane-generated layout styles and third-party surface rendering have their own local styles; the structural asset is not a complete visual theme.

Native buttons/inputs and labels expose send, cancel, attach, remove and form actions. ChatFab exposes expanded state and an accessible label; pointer drag uses a 4 px threshold and 8 px viewport edge margin. Composer keyboard behavior distinguishes ordinary send from multiline entry/IME composition. Conversation rename/search and question selection use their source keyboard handlers. Hosts must preserve labels/focus semantics in replacement slots and supply meaningful translations. This specification does not claim a measured accessibility conformance level.

MCP UI content requires an explicitly supplied sandbox proxy URL; the host supplies its authenticated tool-call callback and link policy. Rendering a UI action does not authorize its execution. Agent control requires host opt-in; direct browser WebMCP exposure is an additional explicit option.

```tsx
import { JiniChatProvider, ConversationList } from '@jini-ai/chat/react';
import { ChatPane } from '@jini-ai/chat/react/chat-pane';
<JiniChatProvider transport={transport} i18n={i18n}>
  <ChatPane transport={transport} agents={agents}
    leadingAccessory={<ConversationList {...hostConversationControls} />} />
</JiniChatProvider>;
```

## Evidence and discrepancy

The explicit [React barrel](../../src/react/index.ts) and [pane types](../../src/react/features/chat-pane/types.ts) define the public components/props. Component, form, conversation-list, drag and provider tests supply behavioral evidence only; they were not run. The reference stylesheet is exported for explicit opt-in loading; the host supplies visual styling.

## Embedded widget

`/react/embed` composes the existing pane/FAB with injected per-tab storage and page-action ports. Required host copy includes eyebrow/newThread/cancel/discard/title/fabLabel/placeholder/proposalLabel({title})/proposalGo. New thread with existing messages shows Cancel (initial focus) and Discard; host Escape cancels, and unsubscribe releases that listener. Closing the panel uses hidden while retaining it mounted. Navigation proposals use an explicit button unless policy-approved auto navigation was requested. No focus trap or extra modal role is supplied by the inline reset confirmation.

The embed inserts structural shell styles and supports `--jini-embed-right` (24px), bottom (88px), width (440px), height (620px), z-index (1000), proposal-background (Canvas) and proposal-color (CanvasText); viewport bounds are 100vw−32px and 100dvh−120px. Host visual CSS and stable effect ports remain required. mountEmbedChat creates a React root in the supplied Element and returns unmount({}).
