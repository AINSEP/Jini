import type { ExportRunSnapshot } from "./export-run.js";

/** One place this site was published or deployed to before, as `GET .../system/publish/destinations`
 *  lists it (`static-publish/publish-history.ts`'s `PublishDestination`), newest first. Labels and
 *  target ids are the server's; no secret is ever in a row (`credentialId` names a saved connection). */
export type StaticDeploymentDestination = {
      id: string;
      kind: "static";
      lastPublishedAt: string;
      label: string;
      url: string;
      target: string;
      projectName: string;
      credentialId?: string;
      configFields: Readonly<Record<string, string>>;
};

export type DeployRunDestination = {
      id: string;
      kind: "deploy";
      /** `started` = the host accepted the deploy but nothing confirmed it landed. */
      status: "started" | "confirmed";
      statusMessage?: string;
      target: string;
      label: string;
      url: string;
      lastPublishedAt: string;
      /** The saved peer at this deploy's address, when there is one: content publishes there. */
      linkedPeerId?: string;
};

export type DeploymentDestination<Peer extends { kind: string }> = StaticDeploymentDestination | DeployRunDestination | Peer;

/**
 * @file What `useStaticExport` needs from the outside world, as an interface rather than a direct
 * `lib/api` import — same shape as `deployment-overview-port.hooks.ts`/`dockerfile-source-port.hooks.ts`
 * in this directory.
 */
export interface StaticExportPort {
  /** Starts a new export run and resolves with the just-started `"running"` snapshot (or, if this
   *  is the actual write and the server refuses it outright — e.g. malformed options — a rejection).
   *  A `409` while a run is already in flight also surfaces as a rejection; see `use-static-export
   *  .hooks.ts`'s own handling of that case. */
  triggerSiteExport(required: {}, optional?: { options?: { clean?: boolean } }): Promise<ExportRunSnapshot>;
  /** The current/most recent run's status — polled while `status === "running"`. */
  getSiteExportStatus(): Promise<ExportRunSnapshot>;
}

/**
 * @file What `useStaticPublish` needs from the outside world, as an interface rather than a direct
 * `lib/api` import — same shape as `static-export-port.hooks.ts` in this directory.
 */
export interface StaticPublishPort<Target, Config extends object, Preview, Run> {
  /** The deploy targets the server's deploy registry lists, with their form field specs — the
   *  publish card's host tabs, fields and help all come from this. */
  listPublishTargets(): Promise<Target[]>;
  /** Pure read: validates `config`, reports the base path a real publish would use, and whether a
   *  credential is configured — never starts a run. */
  getPublishPreview(config: Config, optional?: {}): Promise<Preview>;
  /** Starts a new publish and resolves with the just-started `"running"` snapshot. A `409` while a
   *  run is already in flight surfaces as a rejection, same as `StaticExportPort.triggerSiteExport`.
   *
   *  `credentialId` is the saved connection the operator chose — see `api.ts`'s `triggerPublish` for
   *  why the server needs it named rather than resolving the current default itself. */
  triggerPublish(input: { config: Config; projectName: string; credentialId?: string }, optional?: {}): Promise<Run>;
  /** The current/most recent publish run's status — polled while `status === "running"`. */
  getPublishStatus(): Promise<Run>;
}
