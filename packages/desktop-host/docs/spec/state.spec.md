Spec ID: SPEC-JINI-DESKTOP-HOST-STATE
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:251e084f8b4b196e18df8dc41d5e702f273afdb3a82d6b655d1e48f3c69121ab
spec_mode: reverse_spec


# State Contract: desktop-host

## Windows, bridge and resources

Main-window tracking is per port instance and in memory. A successful creation replaces the main reference without closing the preceding window. A matching close callback clears that reference. Tauri uses the optional confirmed `onClosed` binding when supplied; legacy bindings are observed through `isClosed()` every 50 ms with an unreferenced timer until closure. Cancelable close requests never clear tracking. Its generated labels use a module-wide counter, not durable identity.

Electron render invocation owns a hidden window and destroys it in `finally`. The request policy belongs to the supplied session and has no restoration/disposal step; consumers should provide an isolated render session. Render timeout settles the promise without canceling the underlying work independently; adapter window destruction supplies cleanup.

Mock bridge installation snapshots direct global properties on the supplied scope and distinct object-valued window, installs one mock, and returns a restoration function. Restore reinstates values/existence, not original property descriptors. Nested installs require consumer-controlled restoration order; it is not a concurrent ownership registry.

Node sidecar handle owns child and optional log descriptor. Shutdown closes the descriptor after its termination attempts; there is no shared shutdown-promise/idempotency latch. Readiness maintains observation state per call. Node removes its exit listener in `finally`; Tauri process APIs offer no removal and readiness/shutdown accumulate listeners. The consumer owns the launcher handle lifecycle.

## Graceful quit

Tracker holds settlement promises until completion, removes them on settlement and loops over snapshots until none remain. Rejected work resolves normally through tracking; callers must separately capture its diagnostics. Nothing persists across restart.

Quit phase is consumer-owned: `idle → draining → drained`. `decideBeforeQuit` reads but does not change phase. Repeated quit during `draining` holds. Signal routing creates one `requested` latch per installation and persistent listeners plus a force-exit timer; there is no timer cancellation or disposal API. Avoid repeated registration.

## Updates and presence persistence

Controller state is per instance: construction time, start/stop flags, last check time, checking flag, ready/prompted version, restart intent, install-start flag and timer handles. Construction attaches updater listeners and configures flags. `start` is idempotent; `willQuit` is terminal/idempotent and stops tracked timers/removes own record. Listener registrations survive until updater/host destruction; stopped callbacks return immediately. Timing and update cache/download persistence belong to injected ports.

Presence files are `<directory>/<pid>.json`, containing numeric `{pid,startedAt,heartbeatAt}`. Writes stage `<target>.<writerPid>.tmp` then rename. Reads enumerate numeric filenames, validate finite numeric fields/name match and probe PID liveness; confirmed-dead records are removed, malformed/unreadable records are retained. Timestamp staleness excludes updater ownership but does not remove a still-live sibling from final-install gating. PID reuse can conservatively delay install. No locking/fsync/transaction is supplied.

## Geometry, toolchain and speech

Window geometry persistence is injected `BoundsStorePort`, keyed by caller string; no default store/filename/schema migration is supplied. The package accepts finite rectangle fields, restores sufficient display overlap or returns only fallback width/height. Menu/search/spelling registrations own listener/channel bindings and return disposers; native removal is optional in the supplied ports.

Toolchain shims persist in caller-selected directories; cache/prefix creation does not install packages. Three per-file atomic replacements have no batch transaction. Transient launch reuses durable state only through consumer probes. Failed write cleans up that shim's temporary file; earlier replacements remain.

Speech IPC bindings return a channel-removal disposer. Transcription selection and bridge contain no recording store. macOS compilation treats binary existence as its cache validity test: no source/version hash, refresh, lock or shared in-flight compile promise. Scratch file names are caller-owned; a `finally` removal follows write/transcription attempts. Speech authorization/model assets persist in the operating system, not a package store.

Sources: [tracking](../../src/window-lifecycle.ts), [Tauri lifecycle](../../src/tauri/tauri-window-lifecycle.ts), [controller](../../src/electron/updates/auto-update-controller.ts), [presence](../../src/electron/updates/instance-presence.ts), [toolchain](../../src/node-toolchain/index.ts), [macOS adapter](../../src/speech/macos/mac-on-device-transcriber.ts).
