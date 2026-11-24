# DNS change tools for a site host (`@jini-ai/devops/dns/site/*`)

Site-level orchestration over the DNS kernel (`@jini-ai/devops/dns`): plan, copyable instructions
and verification for one workspace's hostnames, the `domain_binding` tracking store, the mail DNS
status projection and the two mail DNS agent tools.

| subpath | what it owns |
|---|---|
| `dns/site/mail-requirements` | `include: ["mail"]`: the active mail provider's records join a hostname's requirements; DMARC is never doubled or overwritten. |
| `dns/site/binding.repo` | `createDomainBindingStore`: workspace-scoped compare-and-swap store over the host's `domain_binding` table. |
| `dns/site/dns-changes` | `planDomainDns`, `domainDnsInstructions`, `inspectDomainDns`, `verifyDomainDns` (the single writer of `domain_binding.status`), `verifyDueDomainBindings` (sweep body). |
| `dns/site/mail-dns-status` | `readMailDnsStatus` (unsaved check) and `verifyMailDnsStatus` (saved, scheduled re-checks) record-by-record views. |
| `dns/site/mail-dns-tools` | `mail_dns_status` / `mail_dns_verify` agent tool registrations plus `mailDnsPorts`. |
| `dns/site/tool-deps` | `DnsChangeToolDeps`, the ports object every tool above receives. |

Nothing here writes DNS: a person enters the instruction rows at their DNS host, then verification
checks every authoritative nameserver and schedules the next check (30 s doubling to 10 min, 48 h cap).

## Wiring

The host injects everything; this folder carries no SQL driver, network client or product copy.

- `createDomainBindingStore({ kernel, sql, workspaceId })`: `kernel` is the host's instrumented
  database kernel (only `query(statement)` is used) and `sql` is the SQL template tag that kernel
  accepts (for a Kysely kernel, Kysely's `sql`). The `domain_binding` table and its `version`
  column come from the host's migrations.
- `DnsChangeToolDeps` (`tool-deps`): `workspaceId`, the legacy `authorize` port (adapted to
  `requireToolPermission` from `@jini-ai/core`), the DNS provider `registry`, an
  `AuthoritativeDnsPort` `resolver`, the provider `context`, `now`, and optionally `bindings`
  (absent: verification refuses), `mailRequirements` (the resolved mailer's `domainRequirements`;
  absent: `include: ["mail"]` refuses) and `senderDomainVerification` (the mail provider's own
  verdict, typed by `@jini-ai/core/contracts/mail`; absent: reported as `null`).
- The host mounts `readMailDnsStatus` / `verifyMailDnsStatus` behind its own admin routes with the
  same permissions as the tools (`deployments.read` / `deployments.publish`), and runs
  `verifyDueDomainBindings` on its own scheduler.
- `DomainDnsToolDeps` (`tools`): `workspaceId`, the legacy `authorize` port, and `createChecks`,
  which returns the three bounded public DNS/TLS read operations for one invocation with the given
  operation `authorize` bound in. The host builds it from the DNS diagnostics'
  `createDomainDnsChecks` plus its public resolver, TLS probe and saved publishing hostnames, so
  this package never imports diagnostics. `contributeDomainDnsAndChangeTools({ createDeps,
  createDnsDeps })` (`dns-tools`) registers the read diagnostics, the DNS change tools and the mail
  DNS tools as one `domain-dns` contributor. `DomainDnsToolDeps.publicNames` carries the host's
  hostname validators (`readPublicDomain` / `readPublicDnsName`, for example the DNS diagnostics'
  own); the change tools receive the same pair, and `toolInputPublicNames` turns their
  `DomainDnsInputError` (one class, from `@jini-ai/core/net/public-dns-vocabulary`) into
  `ToolInputError`.
