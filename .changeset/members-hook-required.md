---
"@jini-ai/user-management": minor
---

`Members` now requires its `useMembersHook` prop and no longer defaults to the package's own `useMembers` (it does not import it). Bind `useMembers`, or your own controller hook, at the call site: `<Members useMembersHook={useMembers} … />`.
