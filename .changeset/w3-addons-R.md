---
"@jini-ai/admin": patch
---

Admin: add `screens/email/email-api.types` (the Email page client's wire shapes and the `EmailApi` port) and the Email tab data hooks `screens/email/hooks/use-email{,-overview,-sender,-templates,-template-editor}.hooks`, each taking the host's API port and transport error class (plus the request-id factory and editor opener) on `required`.
