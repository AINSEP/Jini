# resource-monitor

Renderer half of a desktop resource readout (memory/CPU chip, per-site figures, process panel).

- `useResourceReadings` (standalone hook the host calls): pull-only polling of one shared snapshot.
  Polls only while the visibility source is visible, serializes reads across effect replacements,
  discards a reading that straddled a hide/show, logs only the first failure of a streak (through
  `describeErrorForLog`, never the raw native message) and retries a failed read promptly.
- `createResourceStop`: the panel's Stop action — stops only locally managed (no `externalUrl`),
  currently `running` sites through the host's power owner; never a stop-by-PID action.

Unlike `resource-dashboard` (board/list views over records the host already holds), this folder owns
the polling cadence for a live sampler; the two do not overlap.

## Wiring

The host injects:

- `ports.getBridge` — its preload bridge lookup exposing `getResources({ panelOpen })`; channel names
  and the wire snapshot type stay host-owned (the hook reads only `pollIntervalMs`). Keep `ports` stable.
- `ports.document` — the visibility source (normally `document`), plus `ports.setTimer`/`clearTimer`.
- `refreshKey` (optional) — changes when a site lifecycle changes, forcing an early reading.
- `retryDelayMs` (optional, default 5 s) — the retry delay after a failed read; normal cadence comes
  from the sampler's own `pollIntervalMs`.
- `createResourceStop({ projects, power })` — `power.toggle` is the host's existing site power owner.

The host's resources hook module binds the browser ports (bridge lookup, `document`, window timers)
and its resources panel module composes the chip, site figure and panel over the returned snapshot.
