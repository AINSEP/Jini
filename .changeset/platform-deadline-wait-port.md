---
"@jini-ai/platform": minor
---

Next rc: `createDeadlineSignal` accepts an optional cancellable `wait({ ms, signal })`
timer port alongside its existing clock port. It now returns `{ signal, dispose }`;
rc.1/rc.2 consumers must destructure the signal and call `dispose()` in `finally`.
Disposal cancels the pending wait and detaches parent listeners without aborting the
returned signal. Deadline expiry and parent cancellation also release resources;
parent abort reasons and elapsed-budget accounting are preserved.
