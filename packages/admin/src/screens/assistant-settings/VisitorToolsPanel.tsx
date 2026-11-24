import { useId, type ComponentType } from "react";
import { agentHandle } from "@jini-ai/core/agent-handles";
import type { VisitorToolMode, VisitorToolView } from "@jini-ai/core/contracts/site/api-ai-assistant-api-types";
import { trimChars, trimCharsEnd } from "@jini-ai/core/primitives";
import type { InfoTipProps } from "../../react/kit.js";
import { asciiSlug } from "../../shell/lib/ascii-slug.js";
import {
  groupVisitorTools, modeDisabled, type useVisitorToolLimitsDraft, type VisitorToolsController,
} from "./use-visitor-tools.hooks.js";

/**
 * "Visitor tools" tab (owner, 2026-10-22): the tool calls the visitor's assistant may make on a
 * visitor's behalf, each Auto | Ask first | Off — the same segmented control as the chat gear's
 * "Agent plugins". It reads and writes the same service as the chat's visitor-tool tools.
 *
 * Security review F2 (binding): modes change on a click of the segmented radios (no `<select>`),
 * limits persist only from an explicit Save click, and none of this tab's handles may be added to
 * `DIRECT_PAGE_HANDLES` — the admin chat's page clicks here must keep their approval card.
 */
const MODES: readonly { mode: VisitorToolMode; label: string }[] = [
  { mode: "auto", label: "Auto" }, { mode: "ask", label: "Ask first" }, { mode: "off", label: "Off" },
];
/** Agent handles are lowercase hyphenated words; tool ids are server data (`list_posts`, plugin ids). */
function toolHandle({ id, part }: { id: string; part: string }, _options: Record<string, never> = {}): string {
  const slug = trimCharsEnd({ text: asciiSlug({ text: id, trimChars }).slice(0, 40), chars: "-" }) || "tool";
  return `ai-assistant-visitor-tool-${slug}-${part}`;
}
const GROUP_LABELS: Record<VisitorToolView["source"], string> = {
  builtin: "Built-in", plugin: "From plugins", created: "Created", unavailable: "Unavailable",
};

/** The host's segmented radio pill (Auto | Ask first | Off); one radio per item, sharing `name`. */
export interface VisitorToolSegmentedProps {
  name: string;
  items: readonly { key: string; label: string; checked?: boolean | undefined; disabled?: boolean | undefined; change: () => void }[];
}
/** Everything a row needs from the host besides copy: the limits-draft hook and the two widgets. */
interface RowBindings {
  useVisitorToolLimitsDraftHook: typeof useVisitorToolLimitsDraft;
  InfoTip: ComponentType<InfoTipProps>;
  Segmented: ComponentType<VisitorToolSegmentedProps>;
}

export interface VisitorToolsPanelProps extends RowBindings {
  t: (key: string) => string;
  /** The host's bound controller hook (port, namespace, conflict and error rules). */
  useVisitorToolsHook: (required: { t: (key: string) => string }) => VisitorToolsController;
}

export function VisitorToolsPanel(props: VisitorToolsPanelProps) {
  const { t, useVisitorToolsHook: _controllerHook, ...bindings } = props;
  const { InfoTip } = bindings;
  // Called through `props` because the host's hook is a required prop, never a default.
  const controller = props.useVisitorToolsHook({ t });
  if (controller.loadError && !controller.view) {
    return <div className="jini-visitor-tools-message" role="alert">
      <span>{controller.loadError}</span>
      <button type="button" className="btn-secondary" onClick={() => controller.retry()}>{t("Retry")}</button>
    </div>;
  }
  if (!controller.view) return <p role="status">{t("Loading visitor tools…")}</p>;
  const groups = groupVisitorTools({ tools: controller.view.tools });
  return (
    <div className="jini-visitor-tools">
      <p className="jini-visitor-tools-intro">
        {t("What the assistant can do for visitors.")}
        <InfoTip label={t("Auto runs it. Ask first waits for the visitor to click Allow in chat before running. Off hides it.")}
          triggerLabel={t("About visitor tools")} agentHandle="ai-assistant-visitor-tools-info" />
      </p>
      <Notices controller={controller} t={t} />
      {groups.length === 0 ? <p className="jini-visitor-tools-empty">{t("No visitor tools yet.")}</p> : null}
      {groups.map(group => (
        <section key={group.source} className="jini-visitor-tools-group" aria-label={t(GROUP_LABELS[group.source])}>
          {groups.length > 1 ? <h3 className="jini-visitor-tools-group-title">{t(GROUP_LABELS[group.source])}</h3> : null}
          <ul className="jini-visitor-tools-list">
            {group.tools.map(tool => <VisitorToolRow key={tool.id} tool={tool} controller={controller} t={t} bindings={bindings} />)}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Notices({ controller, t }: { controller: VisitorToolsController; t: (key: string) => string }) {
  return <>
    {controller.invalid ? (
      <div className="jini-visitor-tools-message jini-visitor-tools-message--warning" role="alert">
        <span>{t("Saved tool settings can't be read, so every tool is Off.")}</span>
        <button type="button" className="btn-secondary" disabled={controller.busyToolId !== null}
          onClick={() => void controller.repair()}
          {...agentHandle({ handle: "ai-assistant-visitor-tools-reset" }, { role: "button", label: "Turn all visitor tools Off to reset" })}>
          {t("Turn all tools Off to reset")}
        </button>
      </div>
    ) : null}
    {controller.notice ? (
      <p className={`jini-visitor-tools-message jini-visitor-tools-message--${controller.notice.kind}`} role={controller.notice.kind === "error" ? "alert" : "status"}>
        {controller.notice.message}
      </p>
    ) : null}
  </>;
}

function VisitorToolRow({ tool, controller, t, bindings }: { tool: VisitorToolView; controller: VisitorToolsController; t: (key: string) => string; bindings: RowBindings }) {
  const { Segmented } = bindings;
  const nameId = useId();
  const title = t(tool.displayTitle ?? tool.title);
  const description = t(tool.displayDescription ?? tool.description);
  const busy = controller.busyToolId !== null;
  // An unreadable policy is enforced as all-Off server side; show exactly that, not the stale choice.
  const mode = controller.invalid ? "off" : tool.mode;
  return (
    <li className="jini-visitor-tool" aria-labelledby={nameId} aria-busy={controller.busyToolId === tool.id || undefined}>
      <div className="jini-visitor-tool-head">
        <div className="jini-visitor-tool-text">
          <span id={nameId} className="jini-visitor-tool-title">{title}</span>
          <span className="jini-visitor-tool-description">{description}</span>
          {!tool.availability.available ? (
            <span className="jini-visitor-tool-unavailable">{tool.availability.reason ?? t("Not available right now.")}</span>
          ) : null}
        </div>
        <div className="jini-visitor-tool-mode" role="radiogroup" aria-labelledby={nameId}>
          <Segmented name={`visitor-tool-mode-${tool.id}`}
            items={MODES.map(item => ({
              key: item.mode, label: t(item.label), checked: mode === item.mode,
              disabled: modeDisabled({ tool, mode: item.mode, invalid: controller.invalid, busy }),
              change: () => { if (item.mode !== mode) void controller.configure({ toolId: tool.id, mode: item.mode }); },
            }))} />
        </div>
      </div>
      <VisitorToolLimits tool={tool} title={title} controller={controller} t={t} bindings={bindings} />
    </li>
  );
}

function VisitorToolLimits({ tool, title, controller, t, bindings }: { tool: VisitorToolView; title: string; controller: VisitorToolsController; t: (key: string) => string; bindings: Pick<RowBindings, "useVisitorToolLimitsDraftHook">; }) {
  const limits = bindings.useVisitorToolLimitsDraftHook({ tool, configure: controller.configure });
  const ipId = useId();
  const siteId = useId();
  const errorId = useId();
  const locked = controller.invalid || !tool.availability.available;
  const fields = [
    { id: ipId, key: "perIpPerHour" as const, label: t("Per visitor, per hour") },
    { id: siteId, key: "perSitePerDay" as const, label: t("Whole site, per day") },
  ];
  return (
    <details className="jini-visitor-tool-limits">
      <summary>{t("Limits")}</summary>
      {/* No <form>: Enter in a field must not submit — only the Save click persists (F2). */}
      <div className="jini-visitor-tool-limits-body">
        {fields.map(field => (
          <label key={field.key} htmlFor={field.id} className="jini-visitor-tool-limit">
            <span>{field.label}</span>
            <input id={field.id} className="jini-input" type="number" inputMode="numeric" min={1} step={1}
              value={limits.draft[field.key]} disabled={locked}
              aria-invalid={limits.invalid || undefined} aria-describedby={limits.invalid ? errorId : undefined}
              onChange={(event) => limits.edit({ key: field.key, value: event.target.value })}
              {...agentHandle({ handle: toolHandle({ id: tool.id, part: field.key === "perIpPerHour" ? "per-visitor-limit" : "per-site-limit" }) }, { role: "field", label: `${title}: ${field.label}` })} />
          </label>
        ))}
        <button type="button" className="btn-primary" disabled={locked || !limits.dirty || controller.busyToolId !== null}
          onClick={() => void limits.save()}
          {...agentHandle({ handle: toolHandle({ id: tool.id, part: "limits-save" }) }, { role: "button", label: `Save ${title} limits` })}>
          {controller.busyToolId === tool.id ? t("Saving…") : t("Save")}
        </button>
        {limits.invalid ? <span id={errorId} className="jini-visitor-tool-limit-error" role="alert">{t("Use a whole number, 1 or more.")}</span> : null}
        {!limits.invalid ? (
          <span className="jini-visitor-tool-limit-hint">
            {visitorToolDefaultLimitsText({ defaults: controller.view?.defaults, t })}
          </span>
        ) : null}
      </div>
    </details>
  );
}

/** Format the default budget hint independently of the interactive limits editor. */
export function visitorToolDefaultLimitsText({ defaults, t }: { defaults?: VisitorToolView["limits"] | undefined; t: (key: string) => string }, _options = {}): string {
  return t("Default: {ip} per visitor/hour, {site} per site/day.")
    .replace("{ip}", () => String(defaults?.perIpPerHour ?? ""))
    .replace("{site}", () => String(defaults?.perSitePerDay ?? ""));
}
