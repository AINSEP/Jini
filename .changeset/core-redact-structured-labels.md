---
"@jini-ai/core": patch
---

The shared engine masks the value of a quoted multiword key that ends in a credential name (`{"user password": "..."}`, `"Admin API Key"`), and the single-token value on the line after a prefixed credential name (`DB_PASSWORD=` / `APP_SECRET:` followed by a new line).
