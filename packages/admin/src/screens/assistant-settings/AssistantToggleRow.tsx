import { useId, type ComponentType, type InputHTMLAttributes, type ReactNode } from "react";
import type { AgentHandleProps } from "@jini-ai/core/agent-handles";
import type { InfoTipProps } from "../../react/kit.js";

/**
 * One on/off setting on the AI Assistant settings screen: checkbox, bold label, and an ⓘ holding
 * the explainer that used to sit inline under it (2026-10-09 redesign — the copy stays, it just no
 * longer pushes the controls apart). The InfoTip is a sibling of the `<label>`, never inside it,
 * so tapping ⓘ cannot also toggle the checkbox.
 *
 * The checkbox's own `aria-describedby` points at the tip's hidden text, so a screen reader still
 * hears the explainer with the control, as it did when the paragraph was inline.
 *
 * `InfoTip` is injected by the host (its own tip widget) rather than resolved from the admin kit,
 * so a screen that mounts this row needs no `<AdminKitProvider>` above it.
 */
export interface AssistantToggleRowProps {
  label: string;
  info: string;
  checked: boolean;
  disabled?: boolean | undefined;
  onChange: (checked: boolean) => void;
  t: (key: string) => string;
  /** The host's ⓘ tip widget; receives the explainer, the trigger's name and the description id. */
  InfoTip: ComponentType<InfoTipProps>;
  /** Extra ids for `aria-describedby` (an owner-only note rendered by the caller). */
  describedBy?: string | undefined;
  /** `role="switch"` styling for the one control a tab is about (the visitor enable switch). */
  variant?: "checkbox" | "switch" | undefined;
  /** Agent handle spread, attributes only. */
  inputProps?: (InputHTMLAttributes<HTMLInputElement> & Partial<AgentHandleProps>) | undefined;
  infoHandle?: string | undefined;
  /** Status, errors or a nested checklist, rendered under the row. */
  children?: ReactNode;
  className?: string | undefined;
}

export function AssistantToggleRow(props: AssistantToggleRowProps) {
  const infoId = useId();
  const inputId = useId();
  const describedBy = [infoId, props.describedBy].filter(Boolean).join(" ");
  const isSwitch = props.variant === "switch";
  const { InfoTip } = props;
  return (
    <div className={["jini-assistant-toggle", isSwitch ? "jini-assistant-toggle--switch" : "", props.className ?? ""].filter(Boolean).join(" ")}>
      <div className="jini-assistant-toggle-head">
        <input type="checkbox" {...props.inputProps} id={inputId} {...(isSwitch ? { role: "switch" } : {})}
          checked={props.checked} disabled={props.disabled} aria-describedby={describedBy}
          onChange={(event) => props.onChange(event.target.checked)} />
        <div className="jini-assistant-toggle-copy">
          <label htmlFor={inputId}>{props.label}</label>
          {" "}
          <InfoTip label={props.info} triggerLabel={props.t("More info: {name}").replace("{name}", () => props.label)}
            descriptionId={infoId} agentHandle={props.infoHandle} />
        </div>
      </div>
      {props.children}
    </div>
  );
}
