import { AGENT_PRIVATE_ATTRIBUTE, agentHandle } from "@jini-ai/core/agent-handles";
import { START_FRESH_CONFIRMATION, type SiteKeyRecoveryController } from "./hooks/use-site-key-recovery.hooks.js";
import type { SiteKeyTabProps } from "./SiteKeyTab.js";

/**
 * @file The Site key tab's recovery card for a locked site: "Paste your old site key" and "Start
 * fresh" (one typed confirmation). Render only — state, copy and requests live in
 * `hooks/use-site-key-recovery.hooks.ts`.
 *
 * The token field is a password field marked agent-private, so the assistant can never read a
 * pasted key. The final Start fresh button has no agent handle: it removes saved credentials, so a
 * person confirms it.
 */
export function SiteKeyRecoveryCard({ recovery, kit }: { recovery: SiteKeyRecoveryController; kit: SiteKeyTabProps["kit"] }) {
  const translate = recovery.t;
  return (
    <section className="card site-key-recovery-card" {...agentHandle({ handle: "security-site-key-recovery" }, { role: "region", label: "Unlock saved credentials locked with a different site key" })}>
      <h3 className="site-key-status-heading">{translate("Your saved credentials are locked")}</h3>
      {recovery.resultMessage ? (
        <p className="notice" role="status">{recovery.resultMessage}</p>
      ) : (
        <>
          <p className="site-key-status-note">{translate("They were locked with a site key that isn't on this computer.")}</p>
          <SiteKeyUnlockForm recovery={recovery} kit={kit} />
          <SiteKeyStartFresh recovery={recovery} />
        </>
      )}
    </section>
  );
}

function SiteKeyUnlockForm({ recovery, kit: { SecretInput } }: { recovery: SiteKeyRecoveryController; kit: SiteKeyTabProps["kit"] }) {
  const translate = recovery.t;
  return (
    <form
      className="site-key-recovery-unlock"
      onSubmit={(event) => {
        event.preventDefault();
        void recovery.unlock();
      }}
    >
      <label htmlFor="site-key-recovery-key">{translate("Paste your old site key")}</label>
      <div className="site-key-recovery-row">
        <SecretInput
          label={translate("Paste your old site key")}
          id="site-key-recovery-key"
          // Chrome ignores "off" on a password field and offers a saved login password here; this is
          // a pasted secret, never a sign-in, so it uses "new-password" like every other secret field.
          autoComplete="new-password"
          spellCheck={false}
          placeholder={translate("64 characters, 0-9 and a-f")}
          value={recovery.siteKey}
          onChange={(event) => recovery.setSiteKey(event.target.value)}
          {...{ [AGENT_PRIVATE_ATTRIBUTE]: "" }}
        />
        <button type="submit" className="btn-primary" disabled={recovery.unlocking || recovery.siteKey.trim() === ""}>
          {recovery.unlocking ? translate("Unlocking…") : translate("Unlock")}
        </button>
      </div>
      {recovery.unlockError ? <p className="notice error" role="status">{recovery.unlockError}</p> : null}
    </form>
  );
}

function SiteKeyStartFresh({ recovery }: { recovery: SiteKeyRecoveryController }) {
  const translate = recovery.t;
  if (recovery.startFreshStep === "closed") {
    return (
      <div className="site-key-recovery-start-fresh">
        <p className="jini-field-hint">{translate("Lost it? A restore point is saved first, then only the credentials that can't be unlocked are removed.")}</p>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => void recovery.openStartFresh()}
          {...agentHandle({ handle: "security-site-key-start-fresh-open" }, { role: "button", label: "Show what starting fresh would remove" })}
        >
          {translate("Start fresh…")}
        </button>
      </div>
    );
  }
  if (recovery.startFreshStep === "loading") return <p className="site-key-loading">{translate("Checking what would change…")}</p>;
  return (
    <div className="site-key-recovery-start-fresh site-key-recovery-confirm">
      {recovery.preview ? <p>{recovery.preview.detail}</p> : null}
      <label htmlFor="site-key-recovery-confirm">{translate("Type START FRESH to confirm")}</label>
      <div className="site-key-recovery-row">
        <input
          id="site-key-recovery-confirm"
          type="text"
          autoComplete="off"
          spellCheck={false}
          placeholder={START_FRESH_CONFIRMATION}
          value={recovery.confirmText}
          onChange={(event) => recovery.setConfirmText(event.target.value)}
        />
        <button type="button" className="btn-danger" disabled={!recovery.canConfirmStartFresh} onClick={() => void recovery.startFresh()}>
          {recovery.startingFresh ? translate("Starting fresh…") : translate("Start fresh")}
        </button>
        <button type="button" className="btn-ghost" onClick={recovery.cancelStartFresh} {...agentHandle({ handle: "security-site-key-start-fresh-cancel" }, { role: "button", label: "Cancel starting fresh" })}>
          {translate("Cancel")}
        </button>
      </div>
      {recovery.startFreshError ? <p className="notice error" role="status">{recovery.startFreshError}</p> : null}
    </div>
  );
}
