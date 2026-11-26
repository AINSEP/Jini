import type { ComponentType, Dispatch, DragEvent, SetStateAction } from "react";
import type { ExecutionConfig } from "@jini-ai/core/contracts/execution";
import type { ChatTransport, ChatPaneRuntimeAccess, FrontendSessionBridge, KitChatPaneProps, KitUploadAttachments } from "../../../react/kit.js";
import type { UseAssistantChats } from "../../hooks/use-assistant-chats.hooks.js";
import type { ChatDisplayPreferencesController } from "./hooks/use-chat-display-preferences.hooks.js";
import type { ChatAgentPluginsController } from "./hooks/use-chat-agent-plugins.hooks.js";
import type { AssistantRuntimePreferencesController } from "./hooks/use-assistant-runtime-preferences.hooks.js";
import type { bindExecutionConfig } from "./hooks/execution-config.hooks.js";
// The bare hook names below are imported for their TYPE only (`typeof useX` on
// `AssistantDockProps`) — every actual call in this component goes through the matching
// `useXSeam` wrapper instead; see `AssistantDock.hooks.tsx`'s "Seam layer" doc for why.
import type { UseByokRuntime } from "./hooks/byok-runtime.hooks.js";
import type { UseLocalCliSelection } from "./hooks/local-cli-selection.hooks.js";
import type { UseComposerCapabilities } from "./hooks/composer-discovery.hooks.js";
import type { AssistantTransportInput } from "./hooks/assistant-transport.hooks.js";
import type { AssistantDockState } from "./AssistantDock.state.hooks.js";

/**
 * @file The global assistant dock (ADR-049) — every admin page gets the same chat pane on the
 * right, not a routed `/admin/assistant` page. Mounted once in `App.tsx`, outside the routed
 * `content` switch, and toggled via `hidden` (never conditional render) so the conversation
 * survives both a FAB close/reopen AND navigating to a different admin section — matches
 * `examples/reference-web/src/AgentLab.tsx`'s own pane in Jini's own repo: "the pane keeps its
 * conversation across toggles... it also drops out of layout and the tab order when closed, so
 * the page genuinely resizes rather than reserving a gap."
 *
 * Hosts `@jini-ai/chat/react`'s `<ChatPane>` against the host's own `@jini-ai/core`+`@jini-ai/daemon`
 * kernel (`apps/website/src/server/inbound/assistant/agent-daemon-server.ts`, proxied by `apps/website/src/server/runtime/composition/modules/assistant.ts`).
 * Tool execution is not a prop here — it happens server-side: the spawned coding-agent CLI gets
 * `.mcp.json`-injected access to the host's registered tools (`src/assistant/tool-registrations.ts`)
 * and calls them through the daemon's `/api/delegated-tool-calls` gate, which shows up in this
 * same transcript as ordinary `tool_use`/`tool_result` events — `ChatPane` renders those itself.
 *
 * `uploadAttachments` below wires the composer's existing (host-agnostic, `@jini-ai/chat/react`-
 * native) drag-and-drop and file-picker mechanism to this daemon's own `/api/attachments` route —
 * see that route's registration in `apps/website/src/server/inbound/assistant/agent-daemon-scope.ts` and its proxy pass-
 * through in `apps/website/src/server/runtime/composition/modules/assistant.ts` for the rest of the chain (`onStarted` claims the
 * upload and hands the daemon's `AgentExecutor.run()` real `imagePaths`). No `attachmentAccept` is
 * passed — see that prop's own doc, below, for why.
 *
 * `styles/assistant.css` themes the pane. Note that the package does NOT ship zero CSS, contrary to
 * what this comment used to claim: `ChatPane` injects its own complete default theme as a `<style>`
 * tag at mount, appended last in the cascade. Host overrides therefore need either the
 * `--jini-chat-*` custom-property seam or a descendant selector — a flat `.jini-*` rule in
 * `assistant.css` loses even at equal specificity. See that file's header for the full account.
 *
 * Every hook this component's render depends on — the runtime-picker state (`useExecutionConfig`,
 * `useByokRuntime`, `useLocalCliSelection`), the composer-discovery projection
 * (`useComposerCapabilities`, 2026-08-14), the JSX-adjacent state that used to live inline here
 * (`useChatI18n`, `useAssistantTransport`, `useAttachmentUploader`, `useRuntimeAccess`,
 * `useComposerDiscoverySelect`, `useMessagesChangeHandler`, `useRunContext` — extracted 2026-08-18),
 * and the pure decision helpers those hooks call (`shouldPublishOnMessagesChange`,
 * `resolveRunContext`, `resolveComposerDiscoveryOutcome`) — live in `AssistantDock.hooks.tsx`; see
 * that file's own header for why they are split out and which of them carry an `INFO.md` rule-3
 * injectable seam. This file stays the render layer: props/JSX only, wiring each hook's return
 * value onto `<ChatPane>`'s props.
 */

export interface AssistantDockProps {
  kit: { DockChatPane: ComponentType<{ dock: AssistantDockState }> };
  /** The route query when the AI Assistant panel is showing, else null: `?conversation=` is applied only from there. */
  query: URLSearchParams | null;
  /** Applies an authorized `?conversation=` link; required so no live hook is a hidden default. */
  useConversationDeepLink: (required: Required<NonNullable<AssistantDockProps["deepLinkPorts"]>> & { query: URLSearchParams | null; chats: Pick<UseAssistantChats, "select">; principalId: string }) => void;
  /** Overrides for the link's lookup/URL/notice/dock-open ports; production defaults live in the state hook. */
  deepLinkPorts?: Partial<{ lookupConversation: (required: { id: string }) => Promise<boolean>; replaceQuery: (required: { query: URLSearchParams }) => void; notify: (required: { key: "This conversation is no longer available." }) => void; openDock: () => void }>;
  /** The dock's state hook seam (`useAssistantDockState`); a test passes a fake. */
  useAssistantDockStateHook: (props: Omit<AssistantDockProps, "useAssistantDockStateHook" | "kit">) => AssistantDockState;
  /** Pane implementation seam: host wiring tests inject a recorder without replacing Jini's module. */
  ChatPane?: ComponentType<KitChatPaneProps>;
  useExecutionPolicy?: (required: { config: ExecutionConfig; locale: string }) => { allowed: boolean; config: ExecutionConfig; readAllowedForSend: () => Promise<boolean>; visibility: string; note: string | null; preserveChange: (next: ExecutionConfig) => ExecutionConfig; subtitleKey: string };
  /** The gear menu's chat display choices seam (`useChatDisplayPreferences`); a test passes a fake. */
  useChatDisplayPreferences?: () => ChatDisplayPreferencesController;
  /** The gear menu's Agent plugins choice seam (`useChatAgentPluginsPreference`); a test passes a fake. */
  useChatAgentPlugins?: () => ChatAgentPluginsController;
  /** The gear menu's Use Claude in Chrome / Prefer subagents seam; a test passes a fake. */
  useAssistantRuntimePreferences?: () => AssistantRuntimePreferencesController;
  /**
   * This tab's page-control connection, owned by `App.tsx` (it outlives this pane, which unmounts
   * with the dock). `null` until the daemon has attached the surface, or if it never does.
   */
  agentBridge?: FrontendSessionBridge | null;
  /**
   * The conversation-state hook, overridable so a test can drive this component against a fake
   * port without stubbing `fetch` — the `useX`/`useWiredX` consumption shape used throughout
   * `@jini-ai/ui` (`ChatComposer`'s `useWorkingDir = useWiredWorkingDirStatus` is the precedent).
   *
   * Passing a *hook* rather than the port itself is what keeps this component dumb: it never has to
   * know a port exists, only that something supplies it conversation state.
   */
  useChats?: () => UseAssistantChats;
  /**
   * The signed-in admin's id. Scopes the remembered "last conversation" (reopened after a reload)
   * to this workspace and user — see `useWiredAssistantChats`. Omitted, nothing is remembered.
   */
  principalId?: string;
  /**
   * Injectable seam for the locale {@link useAssistantDockChrome} resolves `locale`/`t`/`chatI18n`
   * from. Defaults to the real `useWiredAdminLocale` (2026-08-18, added after live review flagged
   * that this was the one IO hook in the component still called bare): the real hook calls
   * `port.loadLanguage()`, a real `fetch`, which a fake bypasses entirely — a test can now drive
   * `locale`/`t`/`chatI18n` for any locale without stubbing `lib/settings-tabs` or the
   * settings-refresh bus.
   */
  useAdminLocale?: () => string;
  /**
   * Injectable seam for the runtime-picker's Local CLI / API · BYOK config state — see
   * {@link useExecutionConfig}. Defaults to the real hook (MSG-01, 2026-08-06, owner directive:
   * every hook doing DOM/IO work gets this seam, `useChats` above is the in-repo precedent to
   * extend, not stop at). `useExecutionConfig` itself calls `loadExecutionConfig`/
   * `saveExecutionConfig`/`loadAdminExecutionCredential` — a fake here drives this component's
   * rendering without stubbing any of that fetch-backed IO.
   */
  useExecutionConfig?: ReturnType<typeof bindExecutionConfig>;
  /**
   * Injectable seam for BYOK model-discovery state — see {@link useByokRuntime}. Defaults to the
   * real hook, same MSG-01 rationale as `useExecutionConfig` above: the real hook calls
   * `createExecutionPort().listModels`, which a fake bypasses entirely.
   */
  useByokRuntime?: (required: { executionConfig: ExecutionConfig; setExecutionConfig: Dispatch<SetStateAction<ExecutionConfig>> }) => UseByokRuntime;
  /**
   * Injectable seam for the Local CLI picker's agent+model selection — see
   * {@link useLocalCliSelection}. Defaults to the real hook, same MSG-01 rationale as
   * `useExecutionConfig` above: the real hook persists through `saveExecutionConfig`, which a fake
   * bypasses entirely.
   */
  useLocalCliSelection?: (required: { executionConfig: ExecutionConfig; setExecutionConfig: Dispatch<SetStateAction<ExecutionConfig>>; configLoaded: boolean }) => UseLocalCliSelection;
  /**
   * Injectable seam for the composer's discovery-catalog projection — see
   * {@link useComposerCapabilities}. Defaults to the real hook, same MSG-01 rationale as the three
   * above: the real hook calls `projectComposerCapabilities`, which a fake bypasses entirely.
   */
  useComposerCapabilities?: () => UseComposerCapabilities;
  /**
   * Injectable seam for the chat transport — see {@link useAssistantTransport}. Defaults to the
   * real hook (2026-08-18 inline-hook-extraction pass, same `INFO.md` rule-3 rationale as the four
   * above): the real hook calls `createAssistantTransport`, whose `startRun` makes the actual
   * daemon network call, which a fake bypasses entirely.
   */
  useAssistantTransport?: (input: AssistantTransportInput) => ChatTransport;
  /**
   * Injectable seam for the composer's attachment uploader — see {@link useAttachmentUploader}.
   * Defaults to the real hook, same 2026-08-18 rationale as `useAssistantTransport` above: the real
   * hook calls `createDaemonAttachmentUploader`, whose uploads are real `fetch`es to
   * `/api/attachments`, which a fake bypasses entirely.
   */
  useAttachmentUploader?: (required: { t: (key: string) => string }) => KitUploadAttachments;
  /**
   * Injectable seam for the composer's attachment liveness validator — see
   * {@link useAttachmentValidator}. Defaults to the real hook, same rationale as
   * `useAttachmentUploader` above: the real hook's validator probes `/api/attachments/:ref` with a
   * real `fetch`, which a fake bypasses entirely.
   */
  useAttachmentValidator?: () => NonNullable<KitChatPaneProps["validateAttachments"]>;
  /**
   * Injectable seam for the Local CLI picker's agent list/rescan/daemon-online poll — see
   * {@link useRuntimeAccess}. Defaults to the real hook, same 2026-08-18 rationale as the two
   * above: the real hook's `listAgents`/`rescanAgents`/`daemonOnline` are all `fetch`-backed, which
   * a fake bypasses entirely.
   */
  useRuntimeAccess?: () => ChatPaneRuntimeAccess;
  /**
   * SPEC-053: invoked once `useFolderDrop`'s `handleDropCapture` is ready, so `App.tsx`'s wrapping
   * `<aside onDropCapture={...}>` (`AssistantChrome`) can forward a real drop event into it — capture
   * phase, before `@jini-ai/chat`'s own bubble-phase drop handling would expand a dropped folder into
   * per-leaf attachment files. See {@link useFolderDropBridge}'s own doc (`AssistantDock.hooks.tsx`)
   * for why this is a callback rather than a `forwardRef`/`useImperativeHandle` pair: it keeps
   * `AssistantDock` a plain function component, unchanged for every existing caller that renders it
   * without this prop (e.g. this component's own tests). Optional — a caller that does not pass it
   * (any test rendering `AssistantDock` directly) simply never receives folder-drop capture events.
   */
  onFolderDropCaptureReady?: (handleDropCapture: (event: DragEvent<HTMLElement>) => void) => void;
}

/**
 * `agentBridge` is the one prop above not hook-shaped — a plain caller-supplied value, never a
 * resolve-then-call-a-hook seam — so it keeps its own default here (`agentBridge = null` below;
 * until 2026-10-20 a one-line `resolveAgentBridge(override) { return override ?? null; }` resolver)
 * rather than moving to `AssistantDock.hooks.tsx`'s seam layer. The other eight props' resolve-or-default logic lives in
 * that seam layer instead (`useChatsSeam`, `useExecutionConfigSeam`, `useByokRuntimeSeam`,
 * `useLocalCliSelectionSeam`, `useComposerCapabilitiesSeam`, `useAssistantTransportSeam`,
 * `useAttachmentUploaderSeam`, `useRuntimeAccessSeam` — see that file's own "Seam layer" doc for why
 * and for the ESLint cyclomatic-complexity reasoning the old resolver relied on: a `??` inside a
 * separately-scoped function does not count against `AssistantDock`'s own body, unlike the inline
 * `{ useClamp = useSeeMoreClamp }` idiom a single-seam component can afford. The resolver went once
 * the header and leading-accessory JSX moved out (below) and left the body room for the inline idiom.
 *
 * Complexity history: 6 cyclomatic / 2 cognitive (measured; ESLint's `complexity`/`sonarjs/cognitive-complexity`
 * rules, `npx eslint apps/admin/src/components/AssistantDock/AssistantDock.tsx` with both ceilings
 * temporarily set to 1 to read the exact counts). Was 5/2 after the 2026-08-14 resolver-idiom pass
 * (11/2 before it — see the resolver group's own doc comment) until the `chat.get_state`-hang fix
 * (2026-08-30) added one more flat `?.` on `<ChatPane agentControl={{ bridgeAccess:
 * agentBridge?.bridgeAccess }}>`. Still clears the ≤9/≤9 bar outright; no `admin-complexity-debt.json`
 * entry needed.
 *
 * The 6 was: base 1, plus 4 flat, sibling `?:`/`?.`/`??` expressions in the JSX below —
 * `executionMode={... ? "api" : "local"}`, the conditional `conversationId` spread, the
 * active-conversation-title `?.title ?? "the host assistant"` fallback (1 for the ternary, 1 for the
 * spread's own ternary, 1 for `?.` + 1 for `??` on the title fallback), and `agentControl`'s
 * `agentBridge?.bridgeAccess` — none of which wrap another, which is why cognitive stays at 2.
 * Later header, empty-state, auth-warning and skill-tray conditionals grew it past the ≤10 bar;
 * 2026-10-20 moved them into `DockHeader`, `DockLeadingAccessory` and `assistant-dock-props.tsx`'s
 * pure builders, which own those branches (and their tests) now.
 */
export function AssistantDock({ useAssistantDockStateHook, kit: { DockChatPane }, ...props }: AssistantDockProps, _optional = {}) {
  const dock = useAssistantDockStateHook(props);
  return <DockChatPane dock={dock} />;
}

export function bindAssistantDock({ hooks, kit }: {
  hooks: Pick<AssistantDockProps, "useAssistantDockStateHook">;
  kit: AssistantDockProps["kit"];
}, _optional = {}) {
  return function BoundAssistantDock(props: Omit<AssistantDockProps, "kit" | "useAssistantDockStateHook"> & Partial<Pick<AssistantDockProps, "useAssistantDockStateHook">>, _optional = {}) {
    return <AssistantDock {...hooks} {...props} kit={kit} />;
  };
}
