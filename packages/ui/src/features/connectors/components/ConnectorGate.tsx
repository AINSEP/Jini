import { Icon } from '../../../react/components/Icon.js';

export interface ConnectorGateProps {
  title: string;
  body: string;
  ctaLabel: string;
  ctaHref: string;
  onClick?: () => void;
}

/** Locked/gated state shown when the host's provider isn't configured yet (e.g. no API key saved). */
export function ConnectorGate({ title, body, ctaLabel, ctaHref, onClick }: ConnectorGateProps) {
  return (
    <div className="jini-connector-gate" role="region" aria-label={title} data-testid="connector-gate">
      <a className="jini-connector-gate-card" href={ctaHref} target="_blank" rel="noreferrer" onClick={onClick}>
        <div className="jini-connector-gate-icon" aria-hidden>
          <Icon name="settings" size={20} />
        </div>
        <h3 className="jini-connector-gate-title">{title}</h3>
        <p className="jini-connector-gate-body">{body}</p>
        <span className="jini-connector-gate-cta">
          {ctaLabel}
          <Icon name="external-link" size={12} />
        </span>
      </a>
    </div>
  );
}
