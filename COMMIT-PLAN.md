# y5p-dock — Jini half

## Completed design commits

None. The adm-shell-components dock sheet is stopped by its anchor/prerequisite rule. No production files, tests, exports, dependency edges, or changesets were changed. This plan is coordinator scratch and must not be committed.

## Stopped sheet: adm-shell-components (four dock files only)

Jini working branch: `codex/y5p-dockj`. The initial working tree was clean.

The supplied sheet identifies Tovu `48f6802924` as its source baseline. That snapshot resolves the named anchors, but the current source in `/Users/la/Programming/Tovu` is at `685039d820d60977a5369aeb7503bd24f3ad050e` and differs:

| Source under apps/admin/src/components/AssistantDock/ | Sheet anchor | Current source | Status |
| --- | --- | --- | --- |
| AssistantDock.state.hooks.ts | selectedDockAgent L62; useDockChrome L74; useDockPreferences L89; useDockExecution L109; useDockTransport L137; useDockAgent L176; useDockComposer L195; useDockRun L259; useAssistantDockState L305 | L55; L67; L82; L102; L130; L169; L188; L250; L296 respectively | STOP: anchors differ |
| DockChatPane.tsx | chatPaneSessionProps L51; chatPaneChromeProps L102; chatPaneComposerProps L152; DockChatPane L248 | L48; L99; L149; L245 respectively | STOP: anchors differ |
| hooks/execution-config.hooks.ts | storedKeyIo L75; useExecutionConfig L84; useExecutionConfigSeam L108 | No storedKeyIo object; useExecutionConfig L164; useExecutionConfigSeam L224 | STOP: anchors and implementation differ |
| AssistantDock.tsx | AssistantDockProps L88; AssistantDock L233 | Both anchors match | Dependent: requires the stopped state and pane moves |

This is more than a line-number shift. Current execution-config source contains useStoredAdminKey and the main controller body rather than the sheet's useAdminExecutionConfig delegation. Its non-aborted credential-load failure sets hasStoredAdminKey to false; the pinned snapshot instead injects a logging callback. Current state calls a host-bound useMessagesChangeHandler, whereas the pinned snapshot supplies publication dependencies and a transcript-mirror callback directly to the package hook. Restoring the old snapshot would require choosing behavior and wiring outside the authorized verbatim move.

The earlier round's scratch Tovu checkout also retains the matching old source; it is not evidence that the current source still meets the sheet prerequisites.

## Tests and mutations

The existing Jini `packages/admin/src/shell/components/AssistantDock/__tests__/y5-dock.test.tsx` contains the stored-key namespace/global-refresh case. It was read and left unchanged.

No tests were added because the source-anchor gate failed before implementation. Named sheet mutation: **ADOPT_AFTER_DISPATCH**, moving conversation adoption past the first transport dispatch. It was neither applied nor executed. The requested first-turn durability/adoption, pane remount, dock composition, and execution binding characterization remain outstanding. The existing namespace test was not executed.

No tests, installs, builds, typechecks, linters, mutation runs, or counter runs were performed. No git mutations were performed.

## Remaining work / coordinator handoff

Reconcile the sheet with the intended current Tovu source revision, including execution-config error behavior and message-handler binding, then redispatch the four dock moves. The state, pane, and dock counterparts remain absent; existing execution binder/filter code was not changed. No new public subpaths or exports are available for the Tovu half from this dispatch. No G3 completion or keep rule is claimed. All other sheets and the media editor are outside this dispatch.

## Diff closeout

Only COMMIT-PLAN.md was created. No production deletions or cleanup deletions were made.
