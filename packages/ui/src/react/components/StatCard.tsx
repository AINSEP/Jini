// Minimal labeled-number stat tile. Origin: `StatCard` in `PluginsView.tsx`
// (OD), verbatim structural port — the component carried no
// product-specific typing or copy (label/value come entirely from props).
// See archived UI source map.

export interface StatCardProps {
  label: string;
  value: number;
  className?: string;
}

export function StatCard({ label, value, className }: StatCardProps) {
  return (
    <div className={['plugins-view__stat', className].filter(Boolean).join(' ')}>
      <span className="plugins-view__stat-value">{value}</span>
      <span className="plugins-view__stat-label">{label}</span>
    </div>
  );
}
