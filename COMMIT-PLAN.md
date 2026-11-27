# y5q-dock — Jini half

## Ordered design commits completed in the working tree

1. **adm-shell-components — four-file dock subset.** No commit was made; `.git` is read-only. All four requested Jini counterparts are present. The media editor and every other sheet are outside this dispatch.

   Created:
   - `packages/admin/src/shell/components/AssistantDock/AssistantDock.tsx`
   - `packages/admin/src/shell/components/AssistantDock/AssistantDock.state.hooks.ts`
   - `packages/admin/src/shell/components/AssistantDock/DockChatPane.tsx`
   - `packages/admin/src/shell/components/AssistantDock/dock-composer-input.hooks.ts` (private split at voice input)
   - `packages/admin/src/shell/components/AssistantDock/dock-pane-props.tsx` (private projections, split at footer/accessory/display seams)

   Changed:
   - `packages/admin/src/shell/components/AssistantDock/hooks/execution-config.hooks.ts` — preserve the existing binding's hook overrides, persistence copy, and required-hook execution seam.
   - `packages/admin/src/shell/components/AssistantDock/__tests__/y5-dock.test.tsx` — four tests added before production implementation; existing stored-key filtering test retained. Count: 1 before, 5 after. No tests removed.
   - `packages/admin/package.json` — three source exports and browser `jini.entries` rows; dependency edges unchanged.
   - `.changeset/y5-adm-shell-components.md` — extend the existing admin/CMS minor changeset description with the dock work. CMS implementation is untouched.
   - `packages/admin/src/shell/components/AssistantDock/hooks/assistant-transport.hooks.ts` — type-only: allow explicit undefined on the two optional pre-send callbacks, preserving the moved object's existing keys.
   - `packages/admin/src/react/kit-chat-component-types.ts` — type-only: allow explicit undefined on initialMessages and bridgeAccess, preserving the moved projections' existing keys.

## Source baseline and behavior

The dispatched predecessor is `c-tv-y5-adm-3/apps/admin/src/components/AssistantDock/` under the same scratchpad parent. Compared its four files with the main Tovu checkout; the predecessor already uses the Jini execution engine, runtime seams, message publishers, and cleanup panel. Those later composition details are retained here. Import-only relocation differences are bound through required hooks/deps/kit.

The state calls chrome, preferences, execution, transport, agent, composer and run hooks unconditionally in their original order. Transport and deep links receive the same chats object. The transport receives adoption and user-turn durability callbacks. The run retains both refresh publishers, the terminal-status classifier object, a per-render transcript publication callback, and the object-shaped selected-reasoning call. Host transcript mirror writes are required injected effects.

The pane retains provider order, capture handlers, paneKey remounting, the cleanup panel, settings and skill dialogs, footer order, and attachment/working-directory decisions. Poster factories run once per binding, outside render. Host copy, base URL, fetch, desktop check and data attribute name are required inputs.

The existing `subscribeStoredKeyRefresh` and main execution controller are reused; their runtime behavior is unchanged.

## Tests first and named mutations

`y5-dock.test.tsx` was extended before production edits. No test, build, install, typecheck, linter, mutation execution or counter command was run, as required by the dispatch. Passing status and mutation sensitivity remain unverified for Opus.

- `AssistantDock.state.hooks.ts`: **ADOPT_AFTER_DISPATCH** — defer the injected transport's adoption until after first dispatch. The test drives the injected transport contract and checks chats-before-transport, adoption/persistence-before-dispatch, the durable write's conversation id, and shared deep-link chats. The actual adoption/dispatch implementation is a host transport collaborator; no claim is made that an executed mutation in that collaborator has been detected here.
- `AssistantDock.tsx`: **IGNORE_INJECTED_DOCK_STATE** — ignore the provided state hook. The one-call and forwarded-state assertions must fail.
- `DockChatPane.tsx`: **KEEP_PANE_ON_CONVERSATION_SWITCH** — remove `key={chats.paneKey}`. The conversation-switch remount assertion must fail; merely adopting an id must retain the current mount.
- `hooks/execution-config.hooks.ts`: **DROP_MODE_PERSISTENCE** — omit the mode-change persistence call. The write/failure-copy assertion must fail. This case also exercises override hook and port selection.
- The inherited stored-key test retains unrelated namespace, execution namespace, global refresh and unsubscribe assertions.

## Tovu half: required exports and wiring

New public paths, all under `@jini-ai/admin/shell/components/AssistantDock/`:
- `AssistantDock`: AssistantDock, AssistantDockProps, bindAssistantDock.
- `AssistantDock.state.hooks`: useAssistantDockState, AssistantDockState, bindAssistantDockState.
- `DockChatPane`: DockChatPane, bindDockChatPane.

Existing `hooks/execution-config.hooks` now exports useExecutionConfigSeam and preserves bindExecutionConfig's original host hook-override names (useBootScope/useLoader/useInvalidator/useLedger/useStoredKey), plus port and persistWrite. `hooks/execution-config-refresh` already exports subscribeStoredKeyRefresh.

The host AssistantDock binding calls bindAssistantDockState, bindDockChatPane and bindAssistantDock once each. It supplies the required hook/dependency/component objects visible in those signatures, including:
- `hooks.useMessages`: the existing Jini useMessagesChangeHandler; `deps.MESSAGE_CHANGE_DEPS: { isTerminalRunStatus }`; `deps.publishMessages`: the host's one-expression transcript-mirror assignment adapter; `deps.publishSettingsRefresh` and `deps.publishContentRefresh`: the existing shared publishers.
- `hooks.useRuntimeAccess` and `hooks.useAgentsPlaceholder`: the existing wired host hooks; the Jini runtime seam receives them explicitly.
- `deps.selectedLocalCliReasoning`: the existing object-argument Jini helper.
- pane `kit.ChatCleanupPanel`, cleanup header, provider, settings/title/confirmation/mic slots; cleanup and subagent hooks; host skill-confirmation kit.
- pane `deps.createAdminTypedAnswerPoster`, `deps.createMidRunMessagePoster`, `fetch`, `baseUrl: ""`, secret-redaction notification, surface subscription, desktop check, existing title/folder copy and original data-attribute name. Poster creation happens inside the Jini binder, keeping the host binding pure.

The cleanup panel's structural input is DockChatCleanup. If its concrete host view needs the full wired controller type, a one-expression JSX adapter may narrow `props.cleanup` to `ReturnType<typeof useDockChatCleanup>`; it receives the same unmodified object returned by that injected hook. No additional hook call belongs in the binding.

The execution host file calls bindExecutionConfig once and passes the result as hooks.useExecutionConfig to bindAssistantDockState. Keep host stylesheet imports and their existing why-comments. Keep the product-named Window debug declaration with the existing host transcript mirror adapter, not in Jini.

Delete the host state/pane files and repoint their raw tests/types. Add keep rules only after the two retained host files satisfy G3. No Tovu files or keep ledger entries were edited here, and no counter completion is claimed.

## Review and remaining verification

Source review covered every changed file, dependencies, hook order, deferred reads, provider/capture order, product-neutral copy inputs, export registration and size seams. New production files are below 500 lines; the named composition/split/binding units stay within the 50-line bound. No runtime loops, timers, retries or polling were added; existing hooks retain their work and disposal ownership.

Architecture audit: source review found no new package dependency edge or host/product import in Jini production. Validation remains deferred. Function dispositions: dock/state/pane/projections/input split/execution binding — source-reviewed composition; type-only contract widening — no runtime effect. Runtime, declaration compatibility and mutation sensitivity need Opus verification. Test assertions and measurement scope were not weakened.

## Deletions during final scope review

- Removed unused destructured collaborator bindings introduced while splitting.
- Removed test-only placeholder type casts by supplying concrete fake registry, confirmation and skill-dialog values.
- Undid incidental JSON Unicode escaping; no unrelated manifest content remains changed.
- No existing production files or tests were deleted.
