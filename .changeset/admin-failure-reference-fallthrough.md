---
"@jini-ai/admin": patch
---

A failure reply whose `details.errorId` is not a string (a number, `null`) no longer hides the reply's other error IDs: the reader now falls through to the flat `errorId`, then the request ID.
