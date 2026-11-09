import type { PluginCredentialCard } from "@jini-ai/core/contracts/credentials";
import type { SurfaceCardOutcome as SurfaceOutcomeSpec, SurfaceCardUri as UIResourceUri, SurfaceCardApp, SurfaceCardsPort } from "@jini-ai/core/contracts/cards";
import type { SurfaceCardSecretForm as SecretCardForm } from "@jini-ai/core/contracts/cards";

/** Resource stays concrete through waitAtSignInCard's card callback.
 * @agent-note Second host: bind your own card runtime (typically `@jini-ai/ui`'s mcp-ui cards); the
 * waiter's `card` callback returns YOUR `Resource` unchanged, so never cast it to a UI type here. */
export type AgentPluginCardsPort<Resource> = SurfaceCardsPort<Resource>;
/** @agent-note Build-only view of {@link AgentPluginCardsPort}: card builders never wait on a human. */
export type AgentPluginCardBuilders<Resource> = Omit<AgentPluginCardsPort<Resource>, 'waitAtSignInCard'>;

/** Plugin-declared credential-card copy applied to a neutral secret form.
 * @agent-note Second host: `apply` overlays the plugin's declared card (title/intro/key hint) onto the
 * form and returns YOUR form type; it must keep the single masked `token` field and never prefill it. */
export interface AgentPluginCredentialCardForms<Form> {
  apply(input: { card?: PluginCredentialCard; form: SecretCardForm }, options?: Record<string, never>): Form;
}

/** Card identity the host owns.
 * @agent-note Your app's id; it appears in every card URI and is compared on answers. `uriNamespace`
 * is ONE segment (no slashes, e.g. your product id); the fixed suffixes `agent-plugins-connect` and
 * `sign-in-destination` are appended here, and every app is version "1". Changing either breaks
 * answers to cards already in transcripts. */
export interface AgentPluginCardIdentity {
  readonly uriNamespace: string;
  readonly appNames: { readonly connect: string; readonly tokenForm: string; readonly tokenOutcome: string };
}

/** Resolves {@link AgentPluginCardIdentity} into the per-card routes the builders below take.
 * @complexity O(1). */
export function resolveAgentPluginCardIdentity(required: { readonly cardIdentity: AgentPluginCardIdentity; readonly toolId: string }, _optional: Record<string, never> = {}) {
  const { cardIdentity: { uriNamespace, appNames }, toolId } = required;
  return {
    connect: { uriNamespace: `${uriNamespace}/agent-plugins-connect`, toolId, app: { appName: appNames.connect, appVersion: '1' } },
    token: { formApp: { appName: appNames.tokenForm, appVersion: '1' }, outcomeApp: { appName: appNames.tokenOutcome, appVersion: '1' } },
    destination: { uriNamespace: `${uriNamespace}/sign-in-destination`, toolId },
  } as const;
}

/** Product wording on the token form.
 * @agent-note Second host: name YOUR product as the one that checks the token; the text is shown to
 * the human only and must not promise the assistant sees the token. */
export interface AgentPluginAccessTokenFormMessages {
  description(input: { pluginDisplayName: string; helpUrl: string }): string;
}

/**
 * @file The card `agent_plugin_connect` shows while it parks on a human's sign-in (`connect-tool.ts`).
 *
 * Built on `@jini-ai/ui`'s `buildOutcomeSurface`, not `buildConfirmationSurface`: there is nothing
 * here for a human to confirm by tool call — the sign-in element is a link that
 * opens the authenticated host sign-in link, then the plugin's real sign-in page in a new tab
 * (`outcome.ts`'s `openLinkUrl`, wired to the
 * bridge's `openLink` — an outbound navigation, never a delivery through `mcp-ui-tool-calls-route.ts`).
 * Skip answers the existing surface exchange so the assistant can continue the turn.
 * `state: "partial"` is the honest read of "waiting on the human, not failed, not done yet" —
 * `outcome.ts`'s own header explains why that needs to be a real third state, not a boolean folded
 * into success or failure.
 *
 * Plain words only: copy comes from the plugin's explicit credential-card declaration, never its
 * raw plugin.json description, which can contain transport jargon. Older plugins retain the
 * display-name fallback so an absent declaration never blocks a real sign-in.
 * plugin.json has no display-name field; uninstall-confirmation-ui.ts makes the identical choice.
 */

function agentPluginConnectSurfaceUri({ pluginId, uriNamespace }: { pluginId: string; uriNamespace: string }): UIResourceUri {
  return `ui://${uriNamespace}/${encodeURIComponent(pluginId)}`;
}

export type AgentPluginConnectCardSpec =
  | { readonly pluginId: string; readonly pluginDisplayName: string; readonly state: "waiting"; readonly signInUrl: string; readonly exchangeId?: string; readonly credentialCard?: PluginCredentialCard }
  | { readonly pluginId: string; readonly pluginDisplayName: string; readonly state: "connected" }
  | { readonly pluginId: string; readonly pluginDisplayName: string; readonly state: "skipped" };

/**
 * Renders the connect card. Re-sent under the SAME `ui://` URI (keyed by `pluginId`) when the state
 * flips from `"waiting"` to `"connected"`, so the transcript replaces the sign-in link in place —
 * see `outcome.ts`'s own header for why URI reuse is the whole mechanism.
 *
 * @complexity O(1).
 */
export function buildAgentPluginConnectCardWithPorts<Resource>(required: { spec: AgentPluginConnectCardSpec; cards: AgentPluginCardBuilders<Resource>; identity: { uriNamespace: string; toolId: string; app: SurfaceCardApp } }, _optional: Record<string, never> = {}): Resource {
  const { spec, cards, identity } = required;
  const credentialCard = spec.state === "waiting" ? spec.credentialCard : undefined;
  return cards.buildSignInCard({
    uri: agentPluginConnectSurfaceUri({ pluginId: spec.pluginId, uriNamespace: identity.uriNamespace }), toolId: identity.toolId,
    app: identity.app,
    waiting: {
      title: credentialCard?.title ?? `Let's connect ${spec.pluginDisplayName}`,
      description: credentialCard ? `${credentialCard.intro ?? ""} ${credentialCard.permissions ?? credentialCard.keyHint ?? ""}`.trim() : "It's free and takes about two minutes.",
      message: "Waiting for you to sign in...", openLinkLabel: `Sign in to ${spec.pluginDisplayName}`, cancelLabel: "Skip",
    },
    connected: { title: `${spec.pluginDisplayName} connected`, message: "Connected ✓" },
    skipped: { title: "Sign-in skipped", message: `Skipped connecting ${spec.pluginDisplayName}. The assistant can continue without this plugin.` },
    ...spec,
  });
}

/**
 * The masked access-token form `agent_plugin_set_access_token` shows (`access-token-tool.ts`), for a
 * plugin whose server declares `tokenAuth`; its tokens page comes from the plugin metadata.
 *
 * Its one field is the only place the token exists outside the sealed ciphertext it becomes: it is
 * posted straight to the tool-calls route, never through chat. Never pre-filled — every render starts
 * empty. The engine's URI carries the tool/exchange identity, and the outcome reuses it so it
 * replaces the form. This builder supplies domain copy only; the engine owns routing and dismissal.
 *
 * @returns A secret-card form spec without routing parameters or prefilled credentials.
 * @example buildAgentPluginAccessTokenFormWithPorts({ app, messages, spec: { credentials, pluginDisplayName: "Supabase", helpUrl: "https://supabase.com/dashboard/account/tokens" } });
 * @complexity O(1).
 */
export function buildAgentPluginAccessTokenFormWithPorts<Form>(required: { readonly app: SurfaceCardApp; readonly messages: AgentPluginAccessTokenFormMessages; readonly spec: {
  readonly credentials: AgentPluginCredentialCardForms<Form>;
  readonly pluginDisplayName: string;
  readonly helpUrl: string;
  readonly credentialCard?: PluginCredentialCard;
} }, _optional: Record<string, never> = {}): Form {
  const { spec } = required;
  const { pluginDisplayName, helpUrl } = spec;
  return spec.credentials.apply({ card: spec.credentialCard, form: {
    title: `Connect ${pluginDisplayName} with an access token`,
    description: required.messages.description({ pluginDisplayName, helpUrl }),
    submitLabel: "Save token",
    fields: [
      {
        kind: "string",
        name: "token",
        label: `${pluginDisplayName} access token`,
        hint: "Pasted here only. Never shown to the assistant.",
        required: true,
        secret: true,
      },
    ],
    cancelLabel: "Cancel",
    app: required.app,
  } });
}

/**
 * The result that replaces the token form. `message` is caller-controlled and must never carry a
 * token — every call site passes a fixed sentence.
 *
 * @returns Outcome copy; the engine supplies the form's URI when rendering it.
 * @complexity O(1).
 */
export function buildAgentPluginAccessTokenOutcomeWithPorts(required: { readonly app: SurfaceCardApp; readonly spec: {
  readonly pluginDisplayName: string;
  readonly state: "success" | "failure";
  readonly title: string;
  readonly message: string;
} }, _optional: Record<string, never> = {}): SurfaceOutcomeSpec {
  const { spec } = required;
  return {
    title: spec.title,
    details: [{ label: "Connection", value: spec.pluginDisplayName }],
    state: spec.state,
    message: spec.message,
    app: required.app,
  };
}
