---
"@jini-ai/mcp": patch
---

`@jini-ai/platform` is no longer a production dependency of `@jini-ai/mcp`: no source file imports it any more (the config/token writer, the owned JSON install and the federation response reader all take host ports). It stays a devDependency for the real-file tests.
