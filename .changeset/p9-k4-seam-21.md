---
"@jini-ai/core": patch
---

Add `./contracts/site/platform-server-logs` (`ServerLogEntry`, `ServerLogLevel` and their closure `ServerLogSource`, `ServerLogMetadata`): the host-neutral captured server log line shared by a host's log buffer, rotating log-file sink and every reader.
