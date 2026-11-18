---
"@jini-ai/http-kit": patch
---

`createNodeDispatcher` takes an opt-in `expressCompatible` option for a host that replaces Express routes with route lists: Express's path spellings (case, one trailing slash), a 400 for a bad percent-escape in an id (handed to the host's error page when `next` is given), and OPTIONS on a routed path answered 200 with `Allow`. Its own plain 400/404/405/500 answers now state `Content-Length`.
