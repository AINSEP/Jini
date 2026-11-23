# publish-content

- `screen/hooks/publish-availability.store.ts` — `createPublishToLiveAvailabilityStore()` makes the
  one "may this admin publish to a live site" flag every Publish entry point reads
  (`usePublishToLiveAvailable` for React, `isPublishToLiveAvailable` for non-React callers), plus
  the pure `readPublishToLiveAvailability(me)`.

## Wiring

The host owns the instance: it calls `createPublishToLiveAvailabilityStore()` once in its own
module and imports that instance's functions everywhere (state is instance-owned, never module
state in this package). It feeds the flag once its session boot has read `/auth/me`:
`setPublishToLiveAvailable({ next: readPublishToLiveAvailability(me) })`. The store defaults to
`true` (an older server without `canPublishToLive` could publish). Host Publish buttons and the
host's publish-request store read it; nothing else is injected.
