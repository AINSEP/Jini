import type { ComponentType, InputHTMLAttributes } from "react";
import { AGENT_PRIVATE_ATTRIBUTE, agentHandle } from "@jini-ai/core/agent-handles";
import type { AdminSiteKeyStatus } from "@jini-ai/core/contracts/site/site-key";
import type { Translate } from "@jini-ai/core/text";
import type { SiteKeyController, SiteKeyGenerateFailure } from "./hooks/use-site-key.hooks.js";
import { isSiteKeyLocked, siteKeyLockedNote, type SiteKeyRecoveryController } from "./hooks/use-site-key-recovery.hooks.js";
import { SiteKeyRecoveryCard } from "./SiteKeyRecoveryCard.js";

type Empty = Record<string, never>;

/**
 * @file The Secrets page's Site key tab — view/reveal/generate the file half of
 * the host site-key environment variable's resolution (`features/webhooks/keyring.env.ts`, server-side).
 *
 * ## What this tab covers, as of the 2026-09-09 durability fix
 *
 * A generated key file now genuinely protects production too: it lives on the durable data volume
 * (not the container's ephemeral rootfs), the production boot gate accepts it, and the keyring
 * that seals every real stored credential (BYOK, publish/source-control/custom creds,
 * media-provider secrets) can now read one. {@link SiteKeyScopeNotice} still discloses the one
 * remaining gap: webhook signing / newsletter tokens still require the env var in production —
 * that keyring's own construction is deliberately unchanged this pass (a committed regression
 * test pins it). See `server/inbound/admin-http/routes/system/site-key.ts`'s header for the
 * full account, including the accepted tradeoff (a key file now lives beside the database it
 * protects — a volume backup carries both).
 *
 * ## No rotate/replace
 *
 * `POST .../generate` only ever creates. Replacing an existing key would orphan every secret
 * already sealed under the old one, and a confirmation strong enough for that (not a generic "are
 * you sure") is a separate, NOT-built feature — reported as out of scope rather than half-built.
 * Once a key is active (`status.active`), {@link SiteKeyGenerateAction} shows no control that
 * could be mistaken for one.
 *
 * ## Reveal — one mechanism, available any time a key is active
 *
 * An earlier brief had generate show its new value once, at creation, fingerprint-only after
 * that. The owner superseded it: "i want that token to be visible to admins or else when it
 * breaks they have no idea whats going on." {@link SiteKeyRevealAction} is the ONE place this
 * tab ever renders a key VALUE — never on page load, only behind its own explicit click, and
 * usable at any time afterward (not just right after a generate), for exactly the diagnostic
 * reason the owner gave: confirming the value here matches what's set in the host's secrets, or
 * figuring out why credentials stopped decrypting. No audit trail on reveal — this codebase has
 * no general-purpose sensitive-read audit mechanism to hook into (checked, not built here).
 */

export interface SiteKeyTabProps {
  /** DI seam for tests — same convention as every other wired-hook prop in this app. */
  useSiteKeyHook: () => SiteKeyController;
  /** DI seam for the locked site's recovery card. */
  useSiteKeyRecoveryHook: (required: { onRecovered: (() => Promise<void> | void) | undefined }, options?: Empty) => SiteKeyRecoveryController;
  useRevealedKeyCopyHook: (required: {
    hex: string;
    clipboard: { writeText: (text: string) => Promise<void> };
    scheduler: { setTimeout: (callback: () => void, ms: number) => unknown; clearTimeout: (handle: unknown) => void };
  }, options?: Empty) => { copied: boolean; copy: () => Promise<void> };
  useAdminLocaleHook: () => string;
  kit: { SecretInput: ComponentType<Pick<InputHTMLAttributes<HTMLInputElement>, "id" | "autoComplete" | "spellCheck" | "placeholder" | "value" | "onChange"> & { label: string; "data-agent-private"?: string }> };
  copy: {
    siteKeyEnvVarName: string;
    scope: string;
    invalidEnv: string;
    invalidFileSuffix: string;
    siteKeyStatusBadgeLabel: (required: { status: Pick<AdminSiteKeyStatus, "active" | "source" | "envVarName">; t: Translate; fallbackEnvVarName: string }, options?: Empty) => string;
    siteKeyGenerateErrorMessage: (required: { locale: string; error: string }, options?: Empty) => string;
  };
}

export function SiteKeyTab({
  useSiteKeyHook,
  useSiteKeyRecoveryHook: useRecoveryHook, ...props }: SiteKeyTabProps) {


  const controller = useSiteKeyHook();
  const recovery = useRecoveryHook({ onRecovered: controller.refresh });
  return (
    <div
      className="site-key-tab"
      {...agentHandle({ handle: "security-site-key" }, {
        role: "region",
        label: controller.t("View and reveal the site key"),
      })}
    >
      <SiteKeyBody controller={controller} recovery={recovery} {...props} />
    </div>
  );
}

/** Loading/error/loaded split — pulled out purely for the complexity gate, same reasoning
 *  `AccessTokensBody` documents in `AccessTokensTab.tsx`. */
function SiteKeyBody({ controller, recovery, kit, copy, useRevealedKeyCopyHook }: { controller: SiteKeyController; recovery: SiteKeyRecoveryController } & Pick<SiteKeyTabProps, "kit" | "copy" | "useRevealedKeyCopyHook">) {
  const translate = controller.t;
  if (controller.loadError) {
    return (
      <p className="notice error" role="status" {...agentHandle({ handle: "security-site-key-load-error" }, { role: "status", label: "Shows the error when the site key's status could not be loaded" })}>
        {controller.loadError}
      </p>
    );
  }
  if (controller.status === undefined) {
    return <p className="site-key-loading">{translate("Loading…")}</p>;
  }
  return (
    <>
      <SiteKeyScopeNotice runtimeMode={controller.status.runtimeMode} t={translate} copy={copy} />
      {isSiteKeyLocked({ status: controller.status, generateError: controller.generateError }) || recovery.resultMessage ? <SiteKeyRecoveryCard recovery={recovery} kit={kit} /> : null}
      <SiteKeyStatusCard controller={controller} status={controller.status} copy={copy} useRevealedKeyCopyHook={useRevealedKeyCopyHook} />
    </>
  );
}

/** The always-visible "what this covers" disclosure — see this file's header. Rendered
 *  unconditionally, not just on failure: the fact it states is true whether or not anything has
 *  gone wrong, and the owner's own "self-contained" framing is exactly what this exists to make
 *  precise before anyone clicks anything.
 *
 *  Rewritten 2026-09-09 per the owner's live review ("the site key content needs to be simpler
 *  ... users are not gonna know what this even is"): leads with one plain sentence any operator
 *  can act on, keeps the production-only storage tradeoff visible (it changes what someone should
 *  do, not just background trivia), and demotes the webhook/newsletter exception to a de-emphasized
 *  note — same `.jini-field-hint` convention `AgentPlugins.tsx`'s section footnotes use — since it's
 *  a real but secondary caveat, not something a first-time reader needs to parse up front. */
function SiteKeyScopeNotice({ runtimeMode, t: translate, copy }: { runtimeMode: "production" | "local"; t: Translate; copy: Pick<SiteKeyTabProps["copy"], "scope"> }) {
  return (
    <div className="notice warning site-key-scope-notice" {...agentHandle({ handle: "security-site-key-scope-notice" }, { role: "status", label: "What this site key does and does not cover" })}>
      <p>{translate(copy.scope)}</p>
      {runtimeMode === "production" ? (
        <p>{translate("On a live site, this key is stored right next to your database. Anyone who gets a full backup of your server would get both your data and the key that unlocks it.")}</p>
      ) : null}
      <p className="jini-field-hint site-key-scope-detail">
        {translate("One exception: webhook signing and newsletter unsubscribe links use a separate key on your live site.")}
      </p>
    </div>
  );
}

/** The status card — badge + fingerprint + source-specific note + Reveal + Generate. Split out
 *  purely for the complexity gate. Only rendered once the status has loaded, so `status` is the
 *  controller's own, already-narrowed value. */
function SiteKeyStatusCard({ controller, status, copy, useRevealedKeyCopyHook }: { controller: SiteKeyController; status: NonNullable<SiteKeyController["status"]> } & Pick<SiteKeyTabProps, "copy" | "useRevealedKeyCopyHook">) {
  const translate = controller.t;
  return (
    <section className="card site-key-status-card" {...agentHandle({ handle: "security-site-key-status" }, { role: "region", label: "The active site key's source, fingerprint, and reveal control" })}>
      <h3 className="site-key-status-heading">{translate("Site key")}</h3>
      <p className="site-key-status-badge-row">
        <span className={`status ${siteKeyStatusBadgeClass({ active: status.active }, { invalid: status.invalid })}`}>{copy.siteKeyStatusBadgeLabel({ status, t: translate, fallbackEnvVarName: copy.siteKeyEnvVarName }, {})}</span>
        {status.fingerprint ? (
          <span className="site-key-fingerprint-group" title={translate("A short ID for this key. It changes if the key changes.")}>
            <span className="site-key-fingerprint-label">{translate("Fingerprint")}</span>
            <code className="site-key-fingerprint">{status.fingerprint}</code>
          </span>
        ) : null}
      </p>
      <p className="site-key-status-note">{siteKeyLockedNote({ status, generateError: controller.generateError, t: translate }) ?? siteKeyStatusNote(status, translate, copy)}</p>
      <SiteKeyRevealAction controller={controller} useRevealedKeyCopyHook={useRevealedKeyCopyHook} />
      {/* Site-key plan (2026-09-24) §A.6: Generate is hidden by default, not deleted — the
          server route, `useSiteKey`'s `generate()`, and this tab's own `SiteKeyGenerateAction`
          all stay wired (see that component's own header) so a later slice can re-expose it (e.g.
          behind an "advanced" disclosure) without rebuilding the plumbing. There is no existing
          "advanced" disclosure pattern on this tab to tuck it into, so this pass just hides it. */}
    </section>
  );
}

function siteKeyStatusBadgeClass({ active }: { active: boolean }, { invalid = false }: { invalid?: boolean | undefined } = {}): string {
  if (invalid) return "status-warning";
  return active ? "status-ok" : "status-neutral";
}

/** The source-specific explanatory line under the badge — one sentence per case, no `{path}`
 *  template needed (the path is rendered as its own `<code>`, not interpolated into translated
 *  prose). Reworded 2026-09-09 alongside {@link SiteKeyScopeNotice} so the badge's
 *  "environment variable" vs. "key file" distinction is explained in plain terms here rather than
 *  assumed — the badge itself stays terse, this line carries the plain-language context. The
 *  host site-key environment variable name stays in the invalid-env case since fixing it requires
 *  that exact name. The `"none"` case was reworded again for the site-key plan (2026-09-24) item 3:
 *  it used to promise that clicking Generate would save a key to `status.keyFilePath` — stale ever
 *  since Generate was hidden by default (§A.6) in favor of `ensureSiteKeyForBoot` minting one
 *  automatically at boot, and doubly so once no fixed path is even guaranteed to be the one that
 *  ends up used (per-site keys, §A.1). @complexity O(1). */
function siteKeyStatusNote(status: { active: boolean; source: "env" | "file" | "none"; invalid?: boolean; keyFilePath: string }, translate: Translate, copy: Pick<SiteKeyTabProps["copy"], "invalidEnv" | "invalidFileSuffix">) {
  if (status.invalid) {
    return status.source === "env" ? (
      <>{translate(copy.invalidEnv)}</>
    ) : (
      <>
        {translate("The key file at")} <code>{status.keyFilePath}</code> {translate(copy.invalidFileSuffix)}
      </>
    );
  }
  if (status.source === "env") {
    return <>{translate("This key was set up directly on the server rather than as a file, and it's already active — there's nothing to do here. Changing it means updating it on the server and restarting.")}</>;
  }
  if (status.source === "file") {
    return (
      <>
        {translate("Stored in a file on this server, at")} <code>{status.keyFilePath}</code>
      </>
    );
  }
  return <>{translate("A key is created automatically when this site starts.")}</>;
}

/** Reveal — never shown on page load; the button is present whenever a key is active, and clicking
 *  it fetches (and displays, with a copy control) the raw value. Human-only: Reveal carries no agent
 *  handle, so the assistant's page driver cannot click it. {@link SiteKeyRevealedValue}'s
 *  own Hide button toggles it back off, client-side only (no server call). @complexity O(1). */
function SiteKeyRevealAction({ controller, useRevealedKeyCopyHook }: { controller: SiteKeyController } & Pick<SiteKeyTabProps, "useRevealedKeyCopyHook">) {
  const translate = controller.t;
  const status = controller.status;
  if (!status?.active) return null;
  if (controller.revealedHex) {
    return <SiteKeyRevealedValue hex={controller.revealedHex} onHide={controller.hideRevealed} t={translate} useRevealedKeyCopyHook={useRevealedKeyCopyHook} />;
  }
  return (
    <div className="site-key-reveal-action" {...{ [AGENT_PRIVATE_ATTRIBUTE]: "" }}>
      <button
        type="button"
        className="btn-secondary"
        disabled={controller.revealing}
        onClick={() => void controller.reveal()}
      >
        {controller.revealing ? translate("Revealing…") : translate("Reveal")}
      </button>
      {controller.revealError ? (
        <p className="notice error" role="status" {...agentHandle({ handle: "security-site-key-reveal-error" }, { role: "status", label: "Shows the error when revealing the site key failed" })}>
          {controller.revealError}
        </p>
      ) : null}
    </div>
  );
}

/** The browser clipboard and timers bound for `useRevealedKeyCopy`, which only sees these ports. */
const browserClipboard = { writeText: (text: string) => navigator.clipboard.writeText(text) };
const browserScheduler = {
  setTimeout: (callback: () => void, ms: number) => setTimeout(callback, ms),
  clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** The revealed value itself, plus Copy/Hide — the ONLY place in this tab that ever renders a key
 *  VALUE rather than a fingerprint. The value is `data-agent-private`, so no published ancestor's
 *  text carries it to the agent, and neither it nor Copy has a handle. @complexity O(1). */
function SiteKeyRevealedValue({ hex, onHide, t: translate,
  useRevealedKeyCopyHook }: { hex: string; onHide: () => void; t: Translate;
  useRevealedKeyCopyHook: SiteKeyTabProps["useRevealedKeyCopyHook"]; }) {
  const { copied, copy } = useRevealedKeyCopyHook({ hex, clipboard: browserClipboard, scheduler: browserScheduler });
  return (
    <div className="site-key-revealed-value" {...{ [AGENT_PRIVATE_ATTRIBUTE]: "" }}>
      <code {...{ [AGENT_PRIVATE_ATTRIBUTE]: "" }}>{hex}</code>
      <div className="site-key-revealed-actions">
        <button type="button" className="btn-secondary" onClick={() => void copy()}>
          {copied ? translate("Copied!") : translate("Copy")}
        </button>
        <button type="button" className="btn-ghost" onClick={onHide}>
          {translate("Hide")}
        </button>
      </div>
    </div>
  );
}

/** The Generate button + its own error banner. Shown only for the genuinely decidable case — no
 *  key at all (`status.source === "none"`) — never once a key is active, and never for an
 *  existing-but-invalid file or env var either (sol packet-3 finding 3-1, 2026-09-16): the server
 *  route only ever CREATES a key file, so offering Generate against a file that already exists
 *  (valid or not) is a guaranteed 409 with no path to success. A confirmed replace/rotate flow for
 *  that state is a separate, deliberately NOT-built feature (this file's own header). Works in
 *  every runtime mode now (2026-09-09 durability fix) — no longer disabled in production.
 *  @complexity O(1). */
export function SiteKeyGenerateAction({ controller, useAdminLocaleHook, copy }: { controller: SiteKeyController } & Pick<SiteKeyTabProps, "useAdminLocaleHook"> & { copy: Pick<SiteKeyTabProps["copy"], "siteKeyGenerateErrorMessage"> }) {
  const translate = controller.t;
  const status = controller.status;
  if (!status || status.source !== "none") return null;
  return (
    <div className="site-key-generate-action">
      <button
        type="button"
        className="btn-primary"
        disabled={controller.generating}
        onClick={() => void controller.generate()}
        {...agentHandle({ handle: "security-site-key-generate" }, { role: "button", label: "Generate a site key file for this install" })}
      >
        {controller.generating ? translate("Generating…") : translate("Generate a key")}
      </button>
      {controller.generateError ? <SiteKeyGenerateErrorNote failure={controller.generateError} t={translate} useAdminLocaleHook={useAdminLocaleHook} siteKeyGenerateErrorMessage={copy.siteKeyGenerateErrorMessage} /> : null}
    </div>
  );
}

function siteKeyGenerateFailureText({ failure, translate, locale, siteKeyGenerateErrorMessage }: { failure: SiteKeyGenerateFailure; translate: Translate; locale: string; siteKeyGenerateErrorMessage: SiteKeyTabProps["copy"]["siteKeyGenerateErrorMessage"] }, _optional: Record<string, never> = {}): string {
  if (failure.kind === "already-exists") {
    return translate("A key file already exists. This tab only creates a new key — it never overwrites one.");
  }
  return failure.kind === "generic" ? siteKeyGenerateErrorMessage({ locale, error: failure.detail }) : failure.detail;
}

function SiteKeyGenerateErrorNote({ failure, t: translate,
  useAdminLocaleHook, siteKeyGenerateErrorMessage }: { failure: SiteKeyGenerateFailure; t: Translate;
  useAdminLocaleHook: SiteKeyTabProps["useAdminLocaleHook"]; siteKeyGenerateErrorMessage: SiteKeyTabProps["copy"]["siteKeyGenerateErrorMessage"]; }) {
  const locale = useAdminLocaleHook();
  const text = siteKeyGenerateFailureText({ failure, translate, locale, siteKeyGenerateErrorMessage });
  return (
    <p className="notice error" role="status" {...agentHandle({ handle: "security-site-key-generate-error" }, { role: "status", label: "Shows the error when generating a site key file failed" })}>
      {text}
    </p>
  );
}
