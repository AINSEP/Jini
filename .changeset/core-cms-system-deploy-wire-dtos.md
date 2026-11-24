---
"@jini-ai/core": patch
"@jini-ai/cms": patch
---

The deployment overview wire DTOs (`DeploymentOverviewSnapshot`, `DeploymentEnvVarStatus`) are declared in neutral Core at `@jini-ai/core/contracts/site/cms-system-deploy` and no longer exported from the cms spec; the credential and deploy route helpers take object arguments.
