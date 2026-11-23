# posts

Leaf pieces of the admin post editor: byline and publish-time fields, the editor's notice banners
the toolbar's phone-overflow button and its measuring hook, the delete-confirm dialog, the list
port and the admin post types. The editor screen, its data hooks and anything typed against the
host's rich-text editor stay in the host for now. See
`ADS-memory/reports/jini-port/extraction-plan.md` for the reasons.

## Wiring

**What it needs injected.** Every component is props-only and imports no hook.
- `PostAutosaveRecoveryBanner` takes `standingDraftRecoveryMessage`, typed as
  `AdminKit['standingDraftRecoveryMessage']`. It is the same shared function the host already puts
  in its kit.
- `PostAutosaveStaleBanner` takes `staleBasisMessage: (basis) => string`.
- `PostVersionConflictBanner` takes `versionConflictMessage: (conflict) => string`.
  - Both are generic over the host's basis and conflict types. The wording is host-owned
    interpolated copy.
- `ToolbarOverflowMenu` takes `overflow: ToolbarOverflowState` (`{ open, toggle }`). The host's
  measuring hook passes its whole controller.
- `PostAuthorFields` takes `author`, `setAuthor`, `showAuthor` and `setShowAuthor`. The host's
  editor hook owns that state, dirty tracking and persistence; the component holds none.
- `PostPublishAtField` takes `publishAtInput`, `setPublishAtInput` and `scheduled`. The input is a
  `datetime-local` string in the editor's local time, and the host decides what counts as scheduled.
- Inputs are tagged through `agentHandle` from `@jini-ai/core/agent-handles` (`post-author`,
  `post-show-author`, `post-publish-at`), so the host's agent surface can find them by handle.
- Every visible label goes through the injected `t: Translate` (type from `@jini-ai/core/text`).
- `PostDeleteConfirmDialog` takes `kindLabel`, `post` (`id`, `title`), `open`, `pending`,
  `onConfirm`, `onCancel` and `t`; it renders the package's own `ConfirmDialog`.
- `usePostEditorUi` takes the host editor's `save`, the dialog setters and `dirty`;
  `useToolbarOverflow` and `usePostSettingsDialog` take nothing. The host binds them at its editor
  call site and passes the results down as props. `useToolbarOverflow` measures the toggle through
  its `data-toolbar-more` attribute, so it must be paired with `ToolbarOverflowMenu`.
- `PostsListPort` (`hooks/posts-list-port.hooks`) is the interface the host's list hook is given;
  the host binds its request client into it.

**What it provides.**
- `PostAuthorFields` at `@jini-ai/admin/posts/PostAuthorFields`
- `AdminPost` and `AdminPostCreateInput` at `@jini-ai/admin/posts/api/posts-api.types`
- `PostDeleteConfirmDialog` at `@jini-ai/admin/posts/editor/PostDeleteConfirmDialog`
- `PostsListPort` at `@jini-ai/admin/posts/hooks/posts-list-port.hooks`
- `usePostEditorUi`, `useToolbarOverflow`, `usePostSettingsDialog`, `usePostPreviewIframeEscape`
  and `primaryControlsThatFit` at `@jini-ai/admin/posts/hooks/use-post-editor-ui.hooks`
- `PostPublishAtField` and `PostPublishAtFieldProps` at `@jini-ai/admin/posts/PostPublishingFields`
  (the subpath keeps its old file name; there is no `PostPublishingFields` symbol)
- `PostAutosaveRecoveryBanner`, `PostAutosaveStaleBanner` and `PostVersionConflictBanner`
- `ToolbarOverflowMenu`

**Host wiring example.**

```tsx
import { standingDraftRecoveryMessage } from "<host ui kit>";
import { PostAutosaveRecoveryBanner } from "@jini-ai/admin/posts/editor/notices/PostAutosaveRecoveryBanner";
import { PostVersionConflictBanner } from "@jini-ai/admin/posts/editor/notices/PostVersionConflictBanner";
import { postVersionConflictMessage } from "./rules"; // host copy

<PostAutosaveRecoveryBanner recoverableDraft={draft} serverUpdatedAt={updatedAt}
  onRestore={restore} onDiscard={discard} t={t} standingDraftRecoveryMessage={standingDraftRecoveryMessage} />
<PostVersionConflictBanner saveConflict={conflict} versionConflictMessage={postVersionConflictMessage}
  onSaveAnyway={overwrite} onLoadLatest={reload} onDismiss={dismiss} t={t} />
```

Byline and publish-time fields:

```tsx
import { PostAuthorFields } from "@jini-ai/admin/posts/PostAuthorFields";
import { PostPublishAtField } from "@jini-ai/admin/posts/PostPublishingFields";

<PostAuthorFields author={editor.author} setAuthor={editor.setAuthor}
  showAuthor={editor.showAuthor} setShowAuthor={editor.setShowAuthor} t={t} />
<PostPublishAtField publishAtInput={editor.publishAtInput} setPublishAtInput={editor.setPublishAtInput}
  scheduled={editor.isScheduled} t={t} />
```

**Classes.**
- The field components emit `jini-post-publishing__fields`, `jini-post-publishing__field`,
  `jini-field-label` and `jini-post-publishing__scheduled-badge`. No stylesheet in this package ships
  them, so the host styles all four.
- The banners render `jini-post-notice` with `jini-post-notice--warning` / `--error` and
  `jini-post-notice__btn` buttons; the overflow toggle renders `jini-post-toolbar__btn` and
  `jini-post-toolbar__more`. The host styles these classes (it extends its own
  notice/secondary-button/toolbar-button rules to them; its phone-width rules show/order the toggle
  through `jini-post-toolbar__more`).
- The overflow toggle carries `data-toolbar-more`: the host's toolbar-fit hook queries that
  attribute (never a class) to measure the phone row, so styling and measurement cannot drift.

**Must never import.**
- A UI package
- `@tiptap/*`
- Host feature modules (`rules`, hooks, API DTOs)
- Any custom hook (a hook has to arrive as a required prop)
