---
"@jini-ai/core": minor
"@jini-ai/admin": minor
"@jini-ai/cms": patch
"@jini-ai/chat": patch
"@jini-ai/agent-plugins": patch
---

One upload limit sentence: `describeUploadOverLimit` (`@jini-ai/core/text`) gives "That file is X MB; the limit is Y MB." and the server upload cap, chat uploader and Library now use it. Library `useLibrary` takes a host `maxUploadBytes` (default the 50 MiB the server accepts) and `libraryFileProblem` takes `maxBytes`. An approved plugin enable now shows the owner the host's own refusal (failed server and redacted reason, missing access snapshot, sign-in grant refusal) instead of "Details: ToolInputError".
