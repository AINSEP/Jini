---
"@jini-ai/ui": patch
---

Remove private fetch-query shims and point deprecated public type re-exports directly at core. Memory wired hooks require MemoryPortsProvider; deprecated REST/demo singletons remain explicit compatibility bindings pending a breaking-release removal.
