# Admin media source — current state, 2026-10-03

The provisional admin kit was deleted. Media uses the public `@jini-ai/ui-kit/react`
facades and its overridable components. See [PORT.md](./PORT.md) for the 17-file legacy
mapping, retained rationale, contracts and host responsibilities. Earlier prototype
validation and file inventories are historical; they do not describe the current kit.

## Shape and usage

Framework-free models, ports, rules, controllers and adapters serve lazy React pages/tabs
and the promise-based picker. React state and events live in hooks; TSX contains views.
All public factories/functions use two object arguments. Ports provide authentication,
original URLs, refresh events, optional replacement/restoration and provider settings.

```tsx
import { createAdmin } from '@jini-ai/admin/core/module';
import { media } from '@jini-ai/admin/media/react';
import { createHttpMediaApi } from '@jini-ai/admin/media/adapters/http';
import { createOverlayController } from '@jini-ai/admin/react/overlays';
import { KitProvider } from '@jini-ai/ui-kit/react';

const overlays = createOverlayController({});
const feature = media({ overlays }, { headerActions: publishControl });
const api = createHttpMediaApi({ transport, basePath }, {
  // Supply only routes the host actually implements.
  restorePath: ({ id }) => `${basePath}/${encodeURIComponent(id)}/restore`,
});
const admin = createAdmin({ modules: [feature], ports: { mediaApi: api } }, {
  permissions: ['media.read', 'media.upload', 'media.update', 'media.trash',
    'media.restore', 'media.delete.force'],
});
const { Page, tabs } = feature.react.pages.library;
// Render the feature Provider, KitProvider and Suspense around Page; mount OverlayHost
// once for overlays. Dispose admin and overlays when retiring the scope.
```

The host supplies its publish control through `media`'s optional `headerActions` slot
(or the media page's `headerActions` prop). It appears at the right of the eyebrow/title/
subtitle header. Publishing itself remains host-owned. Existing bindings that render a
publish contribution above the page must switch to this slot.

## QA fixes and retained behavior

- Image → muted inline video → placeholder probing uses the injected original URL, with
  independent native video controls and original download fallback. No HEAD assumption.
- Read errors and loading are exclusive. Retry, tab re-entry and remount recover through
  the same controller. Retryable failures use automatic 1s/2s/4s backoff capped at 30s,
  indefinitely until successful or disposed; HTTP/network compatibility fallback applies
  when the transport has no explicit retryable flag. Writes are never automatically replayed.
- Choose one or more files, optionally fill alt, then Upload; dropping files uploads directly.
  The native picker is hidden behind a kit button. Success and failure feedback are explicit;
  failed/unattempted files retain their alt, while successful batch entries are not retried.
- Legacy All/Images/Videos retain mixed statuses. A separate Status filter exposes Trash.
  Status pills and optional Restore require a callable enabled port plus `media.restore`.
  Missing restorePath means HTTP has no restore method; no fabricated restore/update fallback.
- Selected sorting, scoped layout, horizontal dialog actions and larger lightbox dimensions
  travel with compiled JS. Closed feature dialogs unmount. The media dialog binding hides
  only the kit default's duplicate Close marker, retaining custom agent-addressable actions
  and the kit's native focus/pending lifecycle; custom kit views retain their own structure.
- Purge confirms the filename, retains cancel-first/pending/human-only kit guards, and focuses
  the next surviving card, previous final card or empty grid after deletion. Cancel restores
  its trigger through the kit. Failed post-delete reads cannot resurrect a deleted card.

## Limits and next verification

Source checks do not establish native playback, real browser focus traps or pixel parity.
No build ran during this dispatch: running consumers still use their existing dist. Next,
coordinate a normal rebuild and real-app QA with the host integration owner. Hosts must
wire header actions, optional restore route/grant, replacement/provider settings, locale/
router/catalogue bindings, byte sniffing/defusal, authorization, purge reference conflicts
and upload limits. Memory is a fake and stores no credentials. The adapter conformance
runner creates/deletes temporary assets; use only an isolated backend.

Current checks: `pnpm --filter @jini-ai/admin exec tsc --noEmit` and
`env -u TOVU_ADMIN_PASSWORD pnpm --filter @jini-ai/admin exec vitest run src/media`.
The deleted `src/react/kit` must not appear in verification commands or imports.
