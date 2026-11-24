# mail/status

The Email page's agent-tool catalogs (`agent-tools`, `provider-agent-tools`, `delivery-agent-tools`),
its permission ids and grant registrar (`permissions`), and `mailDomainDepsFrom` (`domain-deps`), which
binds those ids to the host's activity/suppression deps for one call of the `@jini-ai/platform/mail`
operations.

## Wiring

- `registerMailPermissionGrants({ registry })`: the host passes its permission-grant registry (only
  `roleGrants.register` is used) from its composition root's permission-grant list.
- `mailDomainDepsFrom({ deps })`: the host passes its deps bag (workspace id, `authorize`, owner principal,
  `mailActivity`, `mailSuppressionAdmin`) per call from its admin routes and assistant tool registrations.
- The catalogs are pure data; the host binds handlers to them in its own tool registrations.
