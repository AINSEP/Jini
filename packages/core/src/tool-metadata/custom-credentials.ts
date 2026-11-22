import type { ToolMetadataById } from '../tool-metadata-types.js';
import type { ToolApprovalPolicy } from '../contracts/site/tool-metadata-approval-policy.js';

/** custom-credentials registration declarations; shared placement rationale is in the host aggregator. */
export const toolMetadata = {
  project_keys_list: { search: { keywords: "project keys saved credentials used sites attach" }, approval: { class: "read", confirmation: "direct" } },
  // Revocation has no parked card. A rendered surface must never invoke it as a callback.
  project_key_use: { search: { keywords: "apply use attach detach project saved key stop using site" }, approval: { class: "edit", confirmation: "direct" } },
  site_restart: {
    title: 'Restart this site',
    summary: 'This restarts the site so its saved provider settings can take effect.',
    search: { keywords: "restart site provider settings apply" }, approval: { class: "edit", confirmation: "plan", input: "human-form" }, mcpUi: { redeemable: true, exchangeOnly: true } },
  "credential_copy_from_project": {
    search: {
      keywords: "use saved shared keys reuse credentials local project site grant revoke",
      queries: ["Use a saved key on this site.", "Choose from Shared Keys without copying a token."],
    },
    approval: { class: 'edit', confirmation: 'direct', input: 'human-form' },
    mcpUi: { redeemable: true, exchangeOnly: true },
  },
  "credential_save": {
    search: {
      keywords: "credential save connect add create new account api key token set update change rotate replace expired refresh secret human form " +
        "image generation video media provider openai repository backup git source control commits " +
        "static publish hosting storage bucket registrar dns third-party " +
        "plugin personal access token pat fallback",
      queries: [
        "Save a new API credential through a secure human form.",
        "Set up my hosting account with a hosting API token before deploying an app.",
        "Add a provider token so this site can use my hosting account.",
        "Rotate the token on an existing saved account without changing the username.",
        "Connect an image or video generation provider with an API key.",
        "Save a source control credential for a repository host for commits and site backups.",
        "Save a repository host source control credential.",
        "Set up repository backup credentials.",
        "Connect a static publishing host or object storage account.",
        "Use personal access token sign-in when a plugin OAuth connection cannot start.",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct', input: 'human-form' },
    mcpUi: { secretField: { secret: true } },
  },
  // Operator vocabulary includes DNS, registrars, hosting and third-party APIs, rather than
  // only internal domain names. Setup questions must find secure cards alongside operations.
  "custom_credential_list": {
    search: {
      keywords: "credential credentials token tokens api key keys secret secrets saved connected account accounts " +
        "provider providers registrar registrars dns domain domains hosting host deployment deploy deployments " +
        "third-party thirdparty external outside service services vendor vendors inventory what do i have " +
        "do i have list existing configured connections",
      queries: [
        "List my API keys and show my saved API keys.",
        "What tokens do I have saved? List my tokens.",
        "What credentials do I have saved?",
        "Do I have an API key or token saved for my registrar?",
        "What did I save for my hosting provider — is there already a token for that?",
        "What third-party accounts or providers are connected to this site?",
        "Before I use curl for this, is there already a saved credential I should use instead?",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "custom_credential_make_request": {
    title: 'Send this provider request',
    summary: 'This sends the selected request using your saved credential and may permanently delete provider data.',
    search: {
      keywords: "call calling request requests curl wget http https api endpoint third-party thirdparty external outside " +
        "service services vendor provider dns registrar hosting deployment domain credential credentials token tokens use using saved fetch " +
        "send get post put patch delete hit query invoke run execute",
      queries: [
        "Call an external service API with a saved API token, keeping authentication on the server.",
        "Send an authenticated HTTP request using credentials already stored for the service.",
        "Can you call the registrar API using my saved credential instead of curl?",
        "Make a request to my hosting provider account using the token I already saved.",
        "I need to hit a third-party API with my saved credential — can you do that instead of shelling out?",
        "Can you check my domain's DNS records using the registrar credential I saved?",
        "Use my saved deployment provider token to make an authenticated request to their API.",
      ],
    },
    approval: { class: 'edit', confirmation: 'plan', rule: 'http-method' },
  },
  "custom_credential_set_username": {
    search: {
      keywords: "credential username set add fix repair update change login sign in basic auth account name saved " +
        "api key token 401 unauthorized broken not working",
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
  "custom_credential_verify": {
    search: {
      keywords: "verify verifying valid invalid expired revoked revoke working works work test testing check checking " +
        "credential token api key secret still good bad broken status health healthy alive dead stale current",
      queries: [
        "Is my hosting provider token still valid?",
        "Can you check if this saved API key still works?",
        "Has my registrar credential expired or been revoked?",
        "Test whether this saved token is still good before I rely on it.",
        "Why did my last request through a saved credential fail — is the credential itself the problem?",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "custom_credential_write_files": {
    approval: { class: 'edit', confirmation: 'direct' },
  },
} as const satisfies ToolMetadataById<ToolApprovalPolicy>;
