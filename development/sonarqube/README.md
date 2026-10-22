# Dormant SonarQube Cloud setup

The active Sonar layer is `pnpm quality:sonar`: local ESLint SonarJS warnings,
without Docker, a scanner container, or a SonarQube server. The former Docker
`scan.sh` wrapper has been removed. No token is needed for SonarJS.

`sonar-project.properties` is reserved for Cloud. The `sonar-cloud` GitHub Actions
job is disabled with `if: ${{ false }}`. Enable when the repo is public
(SonarQube Cloud is free for public repos), after these prerequisites are reviewed:

1. Create the Cloud project and replace organization/projectKey placeholders.
2. Set the repository secret `SONAR_TOKEN`; never write its value into properties.
3. Generate fresh package-local LCOV reports using each package's existing coverage
   command. Add the approved coverage-generation steps before the scan in CI.
4. Normalize each report's `SF:` paths to repository-relative paths before import.
   Vitest commonly emits `src/...` relative to its package, which is ambiguous to
   the root scanner. Preserve original reports; verify every imported source path.
5. Review the explicit `sonar.sources` list when workspaces change. Sonar takes
   literal source directories, so it cannot use `packages/*/src` in that property.
   Tests under `packages` are classified separately; no production coverage is excluded.
6. Review the pinned scan-action release and New Code definition before activation.
   Keep scans report-only; quality-gate enforcement is a separate owner decision.

LCOV paths cover top-level workspaces and nested `packages/cms/forms`. Missing or
stale reports are missing coverage evidence, never zero defects or full coverage.
The disabled job does not currently generate or normalize reports.

See [quality-tools.md](../../docs/quality-tools.md) for the shared SonarJS policy,
rule exclusions, syntax-only analysis limits and first-run instructions.
