---
'@jini-ai/http-kit': patch
---

`@jini-ai/http-kit/node-bridge` exports `maxReserializedJsonBytes({ parserLimitBytes })`: the largest size a JSON body can have after the bridge re-serializes what an upstream parser read (5.25 times the parser's limit; a number such as `1e20` prints as 21 digits). A host with a JSON parser in front of the dispatcher passes it as the route-side body limit, so a body the parser accepted is never refused behind it. A request the bridge rebuilds from `parsedBody` now carries headers that describe the rebuilt body: `content-length` is its byte length, and `content-encoding` and `transfer-encoding` are removed, so a gzip JSON body the host's parser already inflated is no longer refused with 415.
