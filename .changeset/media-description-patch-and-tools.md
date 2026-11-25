---
"@jini-ai/cms": minor
"@jini-ai/admin": minor
---

The admin media PATCH route now accepts an optional `description` (blank or null clears it, omitted leaves it unchanged, bounded by the media service's existing length limit). The media import and generation agent tools accept an optional factual `description` of the picture, and the admin media metadata patch types carry an optional `description`.
