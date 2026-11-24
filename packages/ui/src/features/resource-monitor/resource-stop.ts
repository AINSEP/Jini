/** The minimal site fields the stop policy reads. */
export interface StoppableSite {
  readonly id: string;
  readonly externalUrl?: string | null;
  readonly status: string;
}

/** Stop only locally managed sites which are currently running. */
export function createResourceStop<TSite extends StoppableSite>(
  { projects, power }: { projects: readonly TSite[]; power: { toggle: (site: TSite) => unknown } },
  _options = {},
) {
  const byId = new Map(projects.map((site) => [site.id, site]));
  const onStop = ({ id }: { id: string }, _options = {}) => {
    const site = byId.get(id);
    if (site && !site.externalUrl && site.status === "running") void power.toggle(site);
  };
  return onStop;
}
