import { Icon } from "../../../react/kit.js";
import { adminHref } from "../../lib/router.js";

/** The host's banner state hook: reads the mail status once and remembers a dismissal per browser. */
export type UseMailStatusBannerHook<TStatus, TStorage> = (
  required: { fetchStatus: () => Promise<TStatus> },
  optional: { storage?: TStorage | undefined },
) => { visible: boolean; dismiss: () => void };

export interface MailStatusBannerProps<TStatus, TStorage> {
  fetchStatus: () => Promise<TStatus>;
  /** Already translated by the caller: the line, the link to Email, and the × button's name. */
  labels: { text: string; setUp: string; dismiss: string };
  storage?: TStorage;
  useMailStatusBannerHook: UseMailStatusBannerHook<TStatus, TStorage>;
}

/**
 * Banner while no mail provider is chosen (`state: "unconfigured"`, email provider contract v1,
 * 2026-10-21): sign-in links, confirmations and form notifications are refused in production until a
 * provider is set. Owner sign-in itself never needs mail. Dismissible per browser (owner, 2026-10-21:
 * email stays unconfigured on purpose). "Set up email" opens the Email screen's Provider tab (2026-10-22). Logic:
 * the host's injected `useMailStatusBannerHook`; styling: the host's `jini-mail-status-banner*` rules.
 */
export function MailStatusBanner<TStatus, TStorage>({ useMailStatusBannerHook, ...props }: MailStatusBannerProps<TStatus, TStorage>) {
  const { visible, dismiss } = useMailStatusBannerHook({ fetchStatus: props.fetchStatus }, { storage: props.storage });
  if (!visible) return null;
  return (
    <div className="jini-mail-status-banner" role="alert">
      <span className="jini-mail-status-banner-text">
        {props.labels.text}{" "}
        <a className="jini-mail-status-banner-link" href={adminHref({ routePath: "/email?tab=provider" })}>{props.labels.setUp}</a>
      </span>
      <button
        type="button"
        className="jini-mail-status-banner-dismiss"
        aria-label={props.labels.dismiss}
        title={props.labels.dismiss}
        onClick={dismiss}
      >
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}
