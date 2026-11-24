/**
 * @file The install's publish execution mode — `"self-hosted-cli"` (a human has a real terminal on
 * this machine, and the assistant/CLI publish route from the Static Site tab's own header applies) or
 * `"hosted-api-only"` (no terminal exists for this install; only saved provider connections in
 * `publish_credential_sets` can ever publish).
 *
 * Purpose:
 * Explicit and server-provided ONLY — this dispatch's brief is emphatic that this must NEVER be
 * derived from `NODE_ENV` or by sniffing `PATH` for a CLI binary. Both would silently misclassify a
 * real install: `NODE_ENV=production` is set on plenty of self-hosted machines with a real terminal
 * and a signed-in `gh`, and PATH-sniffing only proves a binary exists, not that this process is
 * actually running somewhere a human can reach a terminal for it (a container with `gh` baked into
 * its image but no interactive shell would falsely read as self-hosted-capable).
 *
 * How it relates to the project:
 * A plain env var (the host names it and passes it as `envVarName`) is the same category of
 * operator-supplied config the host already reads directly from its environment for things that
 * aren't (yet) in the encrypted settings store — see the host's static-publish credential source for
 * the precedent this follows (its export-directory and admin-password env vars are the same shape).
 * Defaults to `"self-hosted-cli"` (today's only real mode — Docker/hosted installs are the new case
 * this dispatch adds a path for), so an operator who has not set the var at all keeps today's
 * behavior unchanged.
 */
export type PublishExecutionMode = "self-hosted-cli" | "hosted-api-only";

const DEFAULT_MODE: PublishExecutionMode = "self-hosted-cli";

/**
 * Reads the execution mode from `env[envVarName]`. Any value other than the literal string
 * `"hosted-api-only"` (including unset, blank, or a typo) resolves to the safe default
 * `"self-hosted-cli"` — an unrecognized value must never silently disable the self-hosted CLI path an
 * operator is actually relying on.
 *
 * @param required.env - The environment to read; the host passes its process environment, and a test
 *   passes a plain object so no test needs to mutate real process env vars (which would leak across
 *   parallel test files in the same process — same reasoning the host's env publish-credential
 *   source documents for its own `env` parameter).
 * @param required.envVarName - The host-owned variable name (the package never names one).
 * @complexity O(1).
 * @overallScore 100
 */
export function executionModeFromEnv(
  { env, envVarName }: { env: Readonly<Record<string, string | undefined>>; envVarName: string },
  _optional: Record<string, never> = {},
): PublishExecutionMode {
  return env[envVarName] === "hosted-api-only" ? "hosted-api-only" : DEFAULT_MODE;
}
