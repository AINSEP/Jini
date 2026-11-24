---
"@jini-ai/core": minor
"@jini-ai/infra": minor
"@jini-ai/plugins": minor
"@jini-ai/platform": minor
"@jini-ai/commerce": minor
"@jini-ai/sandbox": minor
"@jini-ai/sidecar": minor
"@jini-ai/server": minor
"@jini-ai/devops": minor
"@jini-ai/chat": minor
"@jini-ai/cli": minor
"@jini-ai/db": minor
"@jini-ai/diagnostics": minor
---

Host runtime helpers extracted from a site host (all product values injected):
`core` `contracts/site/tool-access-change` and `primitives` `createLazyProxy`; `infra` `events/memory-bus` and
`events/domain-outbox`; `plugins` `host/hook-refusals` and host activation polling; `platform`
`secrets/legacy-codecs`; `commerce` checkout origin and commerce settings; `sandbox`
`node-worker/per-call-runner`; `sidecar` parent watchdog, `daemon-origin` and `daemon-park-recovery`;
`server` `shutdown`, `shutdown/boot-work` and `shutdown/idle-park`; `devops` `local-dev` boot listener and
bind-host resolver; `chat` `core/durable-runs/run-finalizer`; `cli` strict stdin request fields and
`parsePortValue`; `devops` `dns` domain-binding sweeper; `diagnostics` `browser-diagnostics`; `db` `transfer` `captureSqliteBackupBytes`.
