---
"@jini-ai/http-kit": minor
---

Add the opt-in `preserveHostErrorRouting: true` mount option for JSON and raw Express routes. Reporter-bound hosts can forward policy rejections to their Express error middleware after the operation ends and retain their existing writer for pre-header response failures. Omit the option to retain the existing reporter behavior.
