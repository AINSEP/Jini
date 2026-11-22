---
"@jini-ai/platform": minor
"@jini-ai/core": minor
---

`createSystemClock` and `createRandomUuidGenerator` move from `@jini-ai/core/primitives` to the new universal `@jini-ai/platform/system` entry; core no longer holds ambient time or randomness. Packages that defaulted to the system clock now take `clock` as a required argument.
