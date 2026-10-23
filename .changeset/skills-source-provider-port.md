---
"@jini-ai/agentic": minor
---

Add injected skill-source fetching and provenance validation with normalized URL input.
Hosts supply fetchSource and validateSource; upload/ZIP and prepare/commit behavior is unchanged.
Keep githubUrl input and fetchGitHubSkill as deprecated compatibility APIs, including legacy
fetching when no source provider is supplied. Normalized url input requires a source provider.
