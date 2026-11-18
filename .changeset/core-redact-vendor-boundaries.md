---
"@jini-ai/core": patch
---

Vendor-shaped keys are masked through their last character: the key rules no longer end with a word boundary that left a trailing `-`, or the whole key when an underscore followed it, visible. A temporary cloud key id glued to a word (`xASIA...`) is masked like the permanent one, and a bare `Basic` or `Token` credential on the line after its scheme word is masked.
