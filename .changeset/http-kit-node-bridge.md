---
"@jini-ai/http-kit": patch
---

New `@jini-ai/http-kit/node-bridge` entry: `createNodeDispatcher` serves a core `Server` route table from Node's `http` request/response objects (plain `node:http`, or mounted as one Express middleware that falls through to the host on no match or a handler error), and `sendWebResponse` writes a web `Response` to a Node `ServerResponse` with backpressure.
