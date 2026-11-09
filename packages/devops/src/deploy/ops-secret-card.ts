// Mechanical extraction provenance is recorded in this package's source-map.md.
type OptionalSecretConfirm = SecretConfirm | undefined;
import { ToolInputError, type ToolExecutionContext, type ToolExecutionOptions } from '@jini-ai/core';
import type { DeployOpsRuntime, DeployOpsSecretCards, SecretConfirm, SetSecretInput } from './ops-tool-contracts.js';
import { requireDeployPlatform } from './ops-registry.js';
import { boundContext, DeployCredentialSetupRequired } from './ops-runner.js';
import { runSetSecret } from './ops-secrets.js';
/** Only the human card receives the value. Neither source nor the model-facing result carries it. */
/** @agent-note Same actor-bound exchange and host card identity; resolve credential before collecting. Recheck write permission after answer. Exact submitted bytes remain in process; fixed safeError and outcome only after save, recovery emits no outcome. */
export async function collectTypedDeploySecret(
  { ctx, deps, cards, input, permit }: { ctx: ToolExecutionContext; deps: DeployOpsRuntime; cards: DeployOpsSecretCards; input: SetSecretInput; permit: () => Promise<void> },
  { emitSurface, confirm }: ToolExecutionOptions & { confirm?: OptionalSecretConfirm } = {},
): Promise<unknown> {
  if (!cards.surfaceExchanges) throw new ToolInputError({ message: cards.noEmitter });
  let locale = cards.defaultLocale;
  const title = `${input.name} · ${input.target}`;
  const card = cards.defineSecretCardTool<{ locale: string }, { result: unknown; saved: boolean; recovery?: true }, unknown>({
    toolId: deps.toolIds.setSecret,
    prepare: async () => {
      if (ctx.signal.aborted) return { locale };
      // Resolve the host credential before collecting another secret, so recovery opens that card first.
      const registry = await deps.loadDeployOps({ workspaceId: deps.workspaceId });
      const platform = requireDeployPlatform({registry,id:input.platform}, {});
      if (!platform.module.setSecret) throw new ToolInputError({ message: "This platform has no secrets adapter." });
      await boundContext({deps,platform,explicit:input.credentialLabel}, {signal:ctx.signal});
      locale = await cards.locale({ctx});
      return { locale };
    },
    form: ({ prep }) => cards.form({locale:prep.locale,title}),
    save: async ({ values, signal }) => {
      try {
        await permit();
        // No trim: provider secrets may contain intentional whitespace and newlines.
        const result = await runSetSecret({ deps, input }, { signal, confirm, typedValue: values.value });
        return { result, saved: result.changed === true || result.comparison === "same" };
      } catch (error) {
        if (error instanceof DeployCredentialSetupRequired) return { result: { executed: false, credentialSetup: error.credentialSetup }, saved: false, recovery: true as const };
        throw error;
      }
    },
    result: ({ prep, run }) => {
      if (run.status === "saved") return run.saved.result;
      if (run.status === "failed" || run.status === "blank") return { changed: false, message: cards.text({ id: "storage", locale: prep.locale }) };
      return { changed: false, cancelled: true };
    },
    outcome: ({ prep, run }) => {
      if (run.status === "saved" && run.saved.recovery) return undefined;
      if (run.status !== "saved" && run.status !== "failed" && run.status !== "blank") return undefined;
      const saved = run.status === "saved" && run.saved.saved;
      return { title, state: saved ? "success" : "failure", message: cards.text({ id: saved ? "savedTitle" : "storage", locale: prep.locale }) };
    },
  }, {
    uriHost: cards.uriHost, text: { noEmitter: cards.noEmitter },
    // Vendor and adapter errors can echo the just-submitted value. Return fixed text only.
    safeError: () => cards.text({ id: "storage", locale }),
  });
  return card.handler({ surfaceExchanges: cards.surfaceExchanges, askThenReport:cards.askThenReport })(ctx, emitSurface ? { emitSurface } : {});
}
