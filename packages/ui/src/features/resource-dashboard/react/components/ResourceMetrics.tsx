import type { ResourceMetric } from '../../types.js';

export interface ResourceMetricsProps {
  metrics: ResourceMetric[];
  ariaLabel: string;
}

/**
 * A row of small metric tiles — TasksView's hero-header
 * active/paused/template-count tiles (`Metric`), generalized over an
 * arbitrary host-supplied list rather than the origin's fixed 3-tile set.
 * Renders nothing when `metrics` is empty rather than an empty `<div>`.
 */
export function ResourceMetrics({ metrics, ariaLabel }: ResourceMetricsProps) {
  if (metrics.length === 0) return null;
  return (
    <div className="jini-resource-dashboard-metrics" aria-label={ariaLabel}>
      {metrics.map((metric) => (
        <div key={metric.key} className="jini-resource-dashboard-metric">
          <span className="jini-resource-dashboard-metric-value">{metric.value}</span>
          <span className="jini-resource-dashboard-metric-label">{metric.label}</span>
        </div>
      ))}
    </div>
  );
}
