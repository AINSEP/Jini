---
"@jini-ai/http-kit": minor
---

Express routes can now report failures through a host's error reporter. When the route context carries `errors` (`{ reporter, observability }`), `mountJsonRoute` turns an unexpected failure into one incident: one `ERR-` ID in the reply, one host record, one tracker report, and one `http.route` operation per request. The new `createReporterRouteInternalError({ reporter })` gives a route that handles its own failure the same ID and record instead of the old sink. Raw routes and the node bridge (`createNodeDispatcher`'s new `reporter` option) can use the same reporter. Hosts that do not pass `errors` or `reporter` behave exactly as before.
