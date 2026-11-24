/** One reading; `null`/absent is an unmeasured value, never a zero. `memoryMetric` names the source of `rssBytes`. */
export interface ResourceReading<K extends string = string> {
  rssBytes?: number | null;
  cpuPercent?: number | null;
  memoryMetric?: K;
}

/** One process row. `name` is an executable basename, never command arguments. */
export interface ResourceProcessRow<K extends string = string, R extends string = string> extends ResourceReading<K> {
  pid: number;
  name: string;
  role: R;
}

/** One table section: an owner (the host app itself, or one of the things it runs), its subtotal and its processes. */
export interface ResourceTableGroup<M extends ResourceReading = ResourceReading, P extends ResourceProcessRow = ResourceProcessRow> {
  id: string;
  title: string;
  metrics?: M;
  processes: readonly P[];
  /** Only groups the host can stop carry a Stop; `null` (e.g. the host app itself) has none. */
  stop: { label: string; disabled: boolean } | null;
}

/** Column headings and spoken words; product copy comes from the host. */
export interface ResourceTableLabels { caption: string; process: string; pid: string; memory: string; cpu: string; actions: string; unavailable: string }

/** Host formatting policy for figures, warnings and role tags (an empty role tag renders nothing). */
export interface ResourceTableFormat<M extends ResourceReading, P extends ResourceProcessRow> {
  /** `reading` is the group subtotal or process row the figure came from (its `memoryMetric` names the source). */
  memory: (required: { bytes: number; reading: M | P }) => string;
  cpu: (required: { percent: number }) => string;
  warning: (required: { metrics: M | undefined }) => string;
  role: (required: { role: P['role'] }) => string;
}

/** Host class added for text kept for screen readers only (the host's visually-hidden utility). */
export interface ResourceTableClassNames { visuallyHidden?: string }

export interface ResourceTableProps<M extends ResourceReading, P extends ResourceProcessRow> {
  groups: readonly ResourceTableGroup<M, P>[];
  onStop: (required: { id: string }, options?: {}) => void;
  labels: ResourceTableLabels;
  format: ResourceTableFormat<M, P>;
  classNames?: ResourceTableClassNames;
}

type Shared<M extends ResourceReading, P extends ResourceProcessRow> = Pick<ResourceTableProps<M, P>, 'labels' | 'format'> & { hidden: string };

const hiddenClass = (host: string | undefined) => (host ? `jini-resources-table__hidden ${host}` : 'jini-resources-table__hidden');

/** A dash for an unknown reading, spoken as "unavailable", never a zero. O(1). */
function Unknown({ label, hidden }: { label: string; hidden: string }) {
  return <><span aria-hidden="true">—</span><span className={hidden}>{label}</span></>;
}

/** Memory and CPU cells; CPU is whatever the host's `format.cpu` says (a note under the table can explain it). O(1). */
function MetricCells<M extends ResourceReading, P extends ResourceProcessRow>({ reading, labels, format, hidden }: Shared<M, P> & { reading: M | P | undefined }) {
  const cpuPercent = reading?.cpuPercent;
  return <>
    <td className="jini-resources-table__num">{reading?.rssBytes == null ? <Unknown label={labels.unavailable} hidden={hidden} /> : format.memory({ bytes: reading.rssBytes, reading })}</td>
    <td className="jini-resources-table__num">{cpuPercent == null ? <Unknown label={labels.unavailable} hidden={hidden} /> : format.cpu({ percent: cpuPercent })}</td>
  </>;
}

/** One `<tbody>` per group: a heading row with the subtotal (and Stop), then its processes. O(p) for the group's p processes. */
function ResourceGroupRows<M extends ResourceReading, P extends ResourceProcessRow>({ group, onStop, ...shared }: Shared<M, P> & { group: ResourceTableGroup<M, P>; onStop: ResourceTableProps<M, P>['onStop'] }) {
  const warning = shared.format.warning({ metrics: group.metrics });
  return <tbody>
    <tr className="jini-resources-table__group">
      <th scope="rowgroup" colSpan={2}>{group.title}{warning && <span className="jini-resources-table__warning"> · {warning}</span>}</th>
      <MetricCells<M, P> reading={group.metrics} {...shared} />
      <td className="jini-resources-table__action">{group.stop && <button type="button" disabled={group.stop.disabled}
        onClick={() => onStop({ id: group.id })}>{group.stop.label}</button>}</td>
    </tr>
    {group.processes.map((row) => {
      const role = shared.format.role({ role: row.role });
      return <tr key={row.pid}>
        <td className="jini-resources-table__process">{row.name}{role && <span className="jini-resources-table__role">{role}</span>}</td>
        <td className="jini-resources-table__num">{row.pid}</td>
        <MetricCells<M, P> reading={row} {...shared} />
        <td />
      </tr>;
    })}
  </tbody>;
}

/** Process | PID | Memory | CPU, grouped by owner; stateless, so the host owns polling and Stop. O(s+p). */
export function ResourceTable<M extends ResourceReading, P extends ResourceProcessRow>({ groups, onStop, labels, format, classNames = {} }: ResourceTableProps<M, P>) {
  const hidden = hiddenClass(classNames.visuallyHidden);
  return <table className="jini-resources-table">
    <caption className={hidden}>{labels.caption}</caption>
    <thead><tr>
      <th scope="col">{labels.process}</th><th scope="col" className="jini-resources-table__num">{labels.pid}</th>
      <th scope="col" className="jini-resources-table__num">{labels.memory}</th><th scope="col" className="jini-resources-table__num">{labels.cpu}</th>
      <th scope="col"><span className={hidden}>{labels.actions}</span></th>
    </tr></thead>
    {groups.map((group) => <ResourceGroupRows<M, P> key={group.id} group={group} onStop={onStop} labels={labels} format={format} hidden={hidden} />)}
  </table>;
}
