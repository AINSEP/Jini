import { suggestCredentialWorksFor } from "@jini-ai/platform/secrets/credential-sets";
import type { SecretCardForm, SurfaceCardApp, SurfaceOutcomeSpec } from "@jini-ai/core/contracts/cards";

/**
 * @file The MCP-UI surfaces `tool-registrations.ts` raises for `custom_credential_create`
 * (2026-09-03) — a multi-field in-chat form for creating a brand-new saved custom credential (label,
 * base URL, category, optional username, and the token), and the result document that replaces it
 * once the save actually finishes.
 *
 * Closes a gap `custom_credential_set_token`'s own header names but does not itself solve: that tool
 * can only ROTATE a token on a credential that already exists (it resolves an existing row by `label`
 * before ever opening its form) — until this file, there was no way for the assistant to create the
 * ROW itself, so an agent that found no saved credential for a provider had to dead-end the human with
 * "go to Admin -> Access Tokens -> Add custom provider" instead of finishing the job in chat. This
 * surface is the rotation card's sibling for the CREATE case, holding up the SAME property
 * that whole mechanism exists for — "a token must never pass through the model's context" — see
 * the Jini secret-card engine's header for the shared reasoning (a human typing a token into
 * ordinary chat text would land in `ai_chat_messages`, the model's own context, and the CLI's session
 * history; this form is the escape from that). Extended with the two fields a NEW row additionally
 * needs that a rotation does not: `baseUrl` and `category` (a closed enum — the Access Tokens page's
 * own filter set, `types.ts`'s `CUSTOM_CREDENTIAL_CATEGORIES`).
 *
 * Structurally closer to `deployment_propose_custom_provider_credential`'s own multi-field form
 * (`features/deployments/publish-agent-tools.ts`'s `buildProposeCredentialForm`) than to
 * `custom_credential_set_token`'s single-field one — both collect several non-secret fields alongside
 * one secret. Driven by the engine's `askThenReport`, like `custom_credential_set_token`: the shared
 * engine's documented premature-Done defect applies here too (a submission's `tools/call` round trip resolving the instant the
 * exchange DELIVERS the click, before `createCustomCredential` has actually run), and this tool sits
 * directly beside `custom_credential_set_token` in `tool-registrations.ts`, so it follows that
 * sibling's precedent rather than the cross-feature one.
 *
 * ## Why the URI carries only the exchange id
 *
 * Same reasoning the rotation card and deployment credential card give: a CREATE has no existing
 * row/version to key against at the point the form is raised — the row does not exist until the human submits — so the exchange id is
 * the only stable handle a fresh form instance has.
 */


/** Non-secret pre-fill hints the model-issued call may carry — see `credential-save-tool.ts`'s
 *  API creation schema for the exact three fields this accepts. All three are optional; an
 *  absent field renders its form control blank rather than pre-filled. */
export interface CreateCredentialPrefill {
  readonly label?: string;
  readonly baseUrl?: string;
  readonly category?: string;
  readonly worksFor?: string[];
}
function buildCredentialCategoryField(prefill: CreateCredentialPrefill, categories: readonly string[]): SecretCardForm["fields"][number] {
  return {
        kind: "enum",
        name: "category",
        label: "Category",
        required: true,
        options: categories.map((id) => ({ value: id })),
        // Defaults to "general" (the closed set's catch-all) when the model supplied no prefill hint —
        // mirrors the admin Access Tokens page's own "Add custom provider" form
        // (`apps/admin/src/features/security/hooks/use-access-tokens.hooks.ts`'s `emptyCustomAddForm`),
        // which has always defaulted this field the same way. Without this, `renderSelect` (required +
        // no `value`) renders a genuinely blank, blocking required select — a human with no obvious
        // category for e.g. a hosting provider's deploy token had nothing sensible to pick. Still freely changeable before
        // submit; a bad/unrecognized prefill still starts unselected, per this file's own header.
        value: prefill.category ?? "general",
      };
}


/** Shared by the form and its later outcome document — see this file's header, "Why the URI carries
 *  only the exchange id". Reusing the SAME uri for both is what makes the outcome REPLACE the form
 *  in the transcript instead of opening a second card. */
// The engine now supplies that shared exchange-keyed URI to both projections.

/**
 * Renders the credential-creation form: label, base URL, category (a closed select drawn from
 * `CUSTOM_CREDENTIAL_CATEGORIES`, defaulting to `"general"` when unprefilled), an optional username,
 * and the masked token field — the ONLY place the token exists outside the sealed ciphertext it
 * becomes a moment later. It is typed directly into this iframe and posted straight to
 * `mcp-ui-tool-calls-route.ts`, never through the assistant's own text channel. A prefilled `category`
 * that does not match one of the fixed options simply starts unselected (`renderSelect`'s own
 * documented behavior) — never a rendering error.
 *
 * @param spec.app - The host's card identity for this form (`CredentialCardIdentity.appNames.create`).
 * @param spec.categories - The host's closed category set (its `CUSTOM_CREDENTIAL_CATEGORIES`).
 * @complexity O(1) — a fixed five-field form (`CUSTOM_CREDENTIAL_CATEGORIES.length` is a small,
 *   compile-time-fixed constant, so the category options list is effectively O(1) too).
 */
export function buildCreateForm(spec: { prefill: CreateCredentialPrefill; providers?: readonly { id: string; vendorId: string; label?: string }[]; app: SurfaceCardApp; categories: readonly string[] }, _optional = {}): SecretCardForm & { preferredFrameSize: readonly [string, string] } {
  const { prefill, providers = [], app, categories } = spec;
  const worksForField = buildWorksForField({ prefill, providers });
  return {
    title: "Save an API credential",
    description:
      "Fill in the credential's label, base URL, and category, and type its token directly into the field below. " +
      "The token is sealed on the server the moment you submit — the assistant never sees it, and it is never " +
      "written to the chat transcript.",
    submitLabel: "Save credential",
    fields: [
      {
        kind: "string",
        name: "label",
        label: "Label",
        hint: "A short display name, e.g. 'repository' or 'registrar'. Must be unique in this workspace.",
        required: true,
        ...(prefill.label !== undefined ? { value: prefill.label } : {}),
      },
      {
        kind: "string",
        name: "baseUrl",
        label: "Base URL",
        hint: "The provider's API base URL, e.g. 'https://api.example.test'.",
        required: true,
        ...(prefill.baseUrl !== undefined ? { value: prefill.baseUrl } : {}),
      },
      buildCredentialCategoryField(prefill, categories),
      ...(worksForField ? [worksForField] : []),
      {
        kind: "string",
        name: "username",
        label: "Username (optional)",
        hint: "An account identifier, if this provider needs one alongside the token — never a secret.",
      },
      {
        kind: "string",
        name: "token",
        label: "Token",
        hint: "Pasted or typed here only — never shown to the assistant.",
        required: true,
        secret: true,
      },
    ],
    app,
    preferredFrameSize: ["100%", "560px"],
  };
}

/** Categories whose credentials the deploy/source-control catalog in `providers` can use. */
const CATALOG_CATEGORIES: ReadonlySet<string> = new Set(["hosting", "source-control"]);

/**
 * The "Works for" picker, or `undefined` when nothing makes it relevant. `providers` is the deploy
 * and source-control catalog, so its hosts are offered only for a hosting/source-control credential
 * (by category, or by a prefilled/suggested target in the catalog). Otherwise only targets the
 * prefill names are offered, and a credential with none — e.g. a mail API key — gets no picker at
 * all instead of every deploy host (2026-10-22, a mail key listed vercel, netlify, s3…). An absent
 * field saves as `worksFor: []`, the same as an empty selection.
 *
 * @complexity O(p + w) in the provider and target counts.
 */
function buildWorksForField({ prefill, providers }: { prefill: CreateCredentialPrefill; providers: readonly { id: string; vendorId: string }[] }): SecretCardForm["fields"][number] | undefined {
  const worksFor = prefill.worksFor ?? suggestCredentialWorksFor({ label: prefill.label ?? "", providers });
  const catalog = providers.flatMap(provider => [provider.id, provider.vendorId]);
  const catalogRelevant = CATALOG_CATEGORIES.has(prefill.category ?? "") || worksFor.some(id => catalog.includes(id));
  const options = [...new Set([...(catalogRelevant ? catalog : []), ...worksFor])];
  if (options.length === 0) return undefined;
  return {
    kind: "multi-enum",
    name: "worksFor",
    label: "Works for (optional)",
    hint: "Also use this key for deploying? Leave this empty unless this is a hosting or deploy key.",
    options: options.map(id => ({ value: id })),
    value: worksFor,
  };
}

/**
 * Renders the RESULT of a submitted create — what replaces the form once the engine's domain
 * save port (`saveCreateCard`, `tool-registrations.ts`) has actually run `createCustomCredential`
 * (or refused to, e.g. a duplicate label or an invalid category). See this file's header for the
 * mechanism and why the engine supplies the same `uri` to both projections.
 *
 * `message` is caller-controlled and must never carry the token itself — enforced by construction at
 * every call site in `tool-registrations.ts`, never by this function, which only renders what it is
 * given (the same division of responsibility as the rotation card's outcome projection).
 *
 * @param spec.app - The host's card identity for the outcome (`CredentialCardIdentity.appNames.createOutcome`).
 * @complexity O(1) — fixed-size field reads.
 */
export function buildCreateOutcome(spec: { label: string; state: "success" | "failure"; message: string; app: SurfaceCardApp }, _optional = {}): SurfaceOutcomeSpec & { preferredFrameSize: readonly [string, string] } {
  const { label, state, message, app } = spec;
  return {
    title: state === "success" ? "Credential saved" : "Credential not saved",
    details: [{ label: "Label", value: label }],
    state,
    message,
    app,
    preferredFrameSize: ["100%", "240px"],
  };
}
