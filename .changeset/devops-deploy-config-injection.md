---
"@jini-ai/devops": minor
---

`@jini-ai/devops/deploy` exports `assertNoConfigInjection({ fieldLabel, value, fail })`, the guard a deploy-config generator runs on a value it interpolates, unescaped, into a generated TOML or YAML file. It refuses a quote or newline, any of `: # { [ & *`, a leading hyphen and leading or trailing whitespace, and throws the error the host's `fail({ message })` builds, so a host keeps its own validation error class. Additive; the generator kit's positional `assertNoConfigInjection(fieldLabel, value)` stays the host's to bind.
