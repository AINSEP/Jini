import { useT } from '../../i18n/index.js';
import type { ConnectorPanelAlert } from '../types.js';
import { Icon } from '../../../react/components/Icon.js';

export interface ConnectorAlertListProps {
  alerts: readonly ConnectorPanelAlert[];
  onOpenDetails: (connectorId: string) => void;
  openDetailsAriaLabel?: (name: string) => string;
  useTHook?: typeof useT;
}

/** Background authorization-failure alerts for connectors not currently open in the detail drawer. */
export function ConnectorAlertList({ alerts, onOpenDetails, openDetailsAriaLabel, useTHook = useT }: ConnectorAlertListProps) {
  const t = useTHook();
  const resolvedOpenDetailsAriaLabel = openDetailsAriaLabel ?? ((name: string) => t('Open details for {name}', { name }));
  if (alerts.length === 0) return null;
  return (
    <div className="jini-connector-panel-alerts">
      {alerts.map((alert) => (
        <div
          key={`${alert.connectorId}:${alert.message}`}
          className="jini-connector-panel-alert"
          title={`${alert.connectorName}: ${alert.message}`}
        >
          <p className="jini-connector-panel-alert-copy" role="status">
            <strong title={alert.connectorName}>{alert.connectorName}</strong>
            <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)' }}>: </span>
            <span title={alert.message}>{alert.message}</span>
          </p>
          <button
            type="button"
            className="icon-only jini-connector-panel-alert-action"
            aria-label={resolvedOpenDetailsAriaLabel(alert.connectorName)}
            title={resolvedOpenDetailsAriaLabel(alert.connectorName)}
            onClick={() => onOpenDetails(alert.connectorId)}
          >
            <Icon name="external-link" size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
