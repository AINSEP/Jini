---
"@jini-ai/admin": minor
---

Require `useOtherCredentialsHook` on the component returned by
`bindAccessTokensTab` and omit it from the factory's hook bindings. Hosts must
supply the hook explicitly when rendering the bound tab. This is a breaking
change to the host contract.
