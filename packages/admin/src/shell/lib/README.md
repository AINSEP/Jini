# admin shell lib

Small, framework-light helpers the admin shell and its host share (buses, route tables, boot and
session helpers). Each file's header states its own contract.

## Wiring

- `boot-token-fragment.ts` — `takeBootToken({ location, history })`: the host injects its own
  `window.location` and `window.history` (narrowed to `hash`/`pathname`/`search` and `replaceState`)
  and calls it once from its boot effect, then redeems the returned token itself. Jini reads no
  ambient `window`, never logs the token, and returns it only to that caller.
