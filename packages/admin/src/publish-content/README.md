# publish-content

- `screen/hooks/publish-availability.store.ts` — `createPublishToLiveAvailabilityStore()` makes the
  one "may this admin publish to a live site" flag every Publish entry point reads
  (`usePublishToLiveAvailable` for React, `isPublishToLiveAvailable` for non-React callers), plus
  the pure `readPublishToLiveAvailability(me)`.
- `screen/hooks/publish-request.store.ts` — `createPublishRequestStore({ isPublishToLiveAvailable })`
  makes the one app-level "a Publish dialog is asked for" store: `requestPublish(criteria, scope?)`
  (returns a promise that always settles), `closePublishRequest()`, `usePublishRequest()`.
- `screen/publish-scope.ts` — `publishScopeTitleKey` / `publishScopeDescriptionKey`: the dialog's
  title and description copy keys for a `PublishScope`, resolved through the host's section table.
- `screen/hooks/use-publish-section-button.hooks.ts` — `usePublishSectionButton({ section, host })`,
  the controller (`visible`, `label`, `onClick`) behind a list page's "Publish <section>" button.

## Wiring

The host owns the instance: it calls `createPublishToLiveAvailabilityStore()` once in its own
module and imports that instance's functions everywhere (state is instance-owned, never module
state in this package). It feeds the flag once its session boot has read `/auth/me`:
`setPublishToLiveAvailable({ next: readPublishToLiveAvailability(me) })`. The store defaults to
`true` (an older server without `canPublishToLive` could publish). Host Publish buttons and the
host's publish-request store read it; nothing else is injected.

The publish-request store is instance-owned the same way: the host calls
`createPublishRequestStore({ isPublishToLiveAvailable })` once, passing a reader that calls its
availability instance on every ask, and its app root mounts the Publish dialog from that instance's
`usePublishRequest`.

`publishScopeTitleKey` / `publishScopeDescriptionKey` take a REQUIRED `sectionForEntityTypes`: the
host's section-table lookup returning `{ labelKey, descriptionKey }` for the one section whose whole
entity-type set matches, or `undefined`. The returned strings are English copy keys the host
translates.

`usePublishSectionButton` takes a REQUIRED module-level `host`: `useLocale()` and
`usePublishToLiveAvailable()` (React hooks, called every render), `sectionById({ id })` (its section
table), `translate({ locale, key })` (its label dictionary) and `requestPublish` (its request-store
instance). The host's button component reads the hook through its own binding.
