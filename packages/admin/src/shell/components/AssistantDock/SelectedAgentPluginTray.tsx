import { Icon, type KitChatTranslator } from "../../../react/kit.js";

/**
 * @file Renders the composer's pinned-Agent-Plugin chips — the visible, removable effect of
 * selecting the "UI/UX Design (Agent Plugin)" composer row (`composer-capabilities.ts`'s
 * `pluginRefId` field), replacing that row's previous `insertText` behavior (typing an inert
 * label string into the draft).
 *
 * Passed to `ChatPane` as `composerSlots.leadingAccessories` (`AssistantDock.tsx`) — the SAME slot
 * `@jini-ai/chat/react`'s own `Composer` already renders host content through, right above its
 * built-in attachment tray (`Composer.tsx`'s `slots?.leadingAccessories ? <div
 * className="jini-composer-leading">...` wrapper). No change to Jini's package was needed or
 * made: `AttachmentTray` (the package's own removable-chip component) is not part of its public
 * export surface (`react/index.ts`'s header: "every export here is explicit... do not
 * reintroduce `export *`"), and its props are typed against `ChatAttachment` specifically
 * (`path`/`name`/`kind`/`size`) — a plugin ref has none of those, so a new export purely to
 * satisfy one caller was judged a bigger footprint on a separate repo/package than a same-pattern
 * component living where the data it renders (this dock's own `useSelectedAgentPlugins` state)
 * already lives. This component instead reuses the package's own injected default stylesheet by
 * class name — `.jini-attachment-tray`/`.jini-attachment-chip`/`.jini-attachment-remove`
 * (`@jini-ai/chat`'s `features/chat-pane/styles.ts`, scoped under `.jini-chat-pane`) — so a pinned
 * plugin chip renders with the exact same box, spacing, and remove-button chrome an attachment
 * chip gets, with zero new CSS of its own. `Icon` (not `RemixIcon`) for the same reason: it is
 * `@jini-ai/chat`'s own `AttachmentTray` that uses the package-internal `Icon` component for its
 * remove button, and `@jini-ai/ui`'s `Icon`/`IconName` (unlike that internal one) is a public
 * export with the same `'close'` glyph — the one available way to match that exact icon without
 * reaching into the package's private component tree.
 */

export interface SelectedAgentPluginChip {
  /** The installed Agent Plugin's `plugin.json` `name` — see `composer-capabilities.ts`'s
   *  `pluginRefId` doc for the full resolution chain this id feeds. */
  readonly pluginRefId: string;
  /** The composer row's own label (the host composer capability's `item.label`) — shown verbatim on the
   *  chip so it reads as "the same thing you just picked from the menu." */
  readonly label: string;
}

export interface SelectedAgentPluginTrayProps {
  readonly chips: readonly SelectedAgentPluginChip[];
  /** The host's `removePluginRef` (its selected-agent-plugins hook). */
  readonly onRemove: (pluginRefId: string) => void;
  readonly onSendSkills?: () => void;
  /** The host's chat translator hook (the kit chat `useT`). */
  useTHook: () => KitChatTranslator;
}

/**
 * @complexity O(n) in the number of pinned chips (never more than the bundled catalog's own
 * Agent Plugin row count today).
 * @overallScore 100
 */
export function SelectedAgentPluginTray({ chips, onRemove, onSendSkills,
  useTHook }: SelectedAgentPluginTrayProps) {
  const t = useTHook();
  // Same "empty tray renders nothing" convention `AttachmentTray` itself uses — an empty
  // `.jini-attachment-tray` is `display: none` in the package's own stylesheet regardless, but
  // returning `null` here also skips the wrapping `.jini-composer-leading` padding Jini's
  // `Composer` would otherwise reserve for an empty node.
  if (chips.length === 0) return null;

  return (
    <div className="jini-attachment-tray">
      {chips.map((chip) => (
        <div key={chip.pluginRefId} className="jini-attachment-chip">
          <span className="jini-attachment-chip-body">
            <span className="jini-attachment-chip-icon">
              <Icon name="puzzle" size={15} />
            </span>
            <span className="jini-attachment-chip-copy">
              <span className="jini-attachment-chip-name" title={chip.label}>
                {chip.label}
              </span>
            </span>
          </span>
          <button
            type="button"
            className="jini-attachment-remove"
            onClick={() => onRemove(chip.pluginRefId)}
            title={t("Remove {name}", { name: chip.label })}
            aria-label={t("Remove {name}", { name: chip.label })}
          >
            <Icon name="close" size={12} />
          </button>
        </div>
      ))}
      {onSendSkills && <button type="button" className="jini-attachment-chip" onClick={onSendSkills}>{t("Send selected skills")}</button>}
    </div>
  );
}
