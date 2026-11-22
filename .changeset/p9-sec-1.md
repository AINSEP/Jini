---
"@jini-ai/admin": minor
---

Security: `security({ ui }, { t, rootKeyScopeNotice, rootKeyTab, tabIcons })` takes the injected module UI (breaking: the first argument was `{}`), renders a kicker/heading/description header and the kit `TabBar` with stable tab handles, flows a host translator through a context without remounting tabs, and hands `rootKeyTab` options to the root-key tab params. Adds `englishSecurity`, `SecurityTranslator`, `SecurityOptions` and `SecurityRootKeyTabOptions`.
