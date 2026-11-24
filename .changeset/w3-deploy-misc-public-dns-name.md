---
"@jini-ai/core": patch
"@jini-ai/diagnostics": patch
"@jini-ai/devops": patch
---

Add `@jini-ai/core/net/public-dns-vocabulary` (`DNS_TYPES`, `DnsRecordType`, `DomainDnsInputError`); `@jini-ai/diagnostics/domain-dns` throws that class and keeps exporting the names. Add `@jini-ai/devops/dns/site/tools` and `@jini-ai/devops/dns/site/dns-tools`: the domain/DNS agent tools, with the public DNS/TLS checks injected through `DomainDnsToolDeps.createChecks` and the hostname validators through `DomainDnsToolDeps.publicNames`.
