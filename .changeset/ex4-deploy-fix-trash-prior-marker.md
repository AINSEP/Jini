---
"@jini-ai/cms": patch
---

`TrashPort.trash` and `RemoveEntity` accept an explicit `priorMarker: undefined`; the widget removal binding forwards `{ priorMarker }` to the injected port in its original shape.
