/** Export-owned stages, retained by the existing in-memory job until its result is collected. */
export type SiteShareExportStep = "prepare" | "archive" | "delivery";

/** An unexpected export exception with its original cause; expected refusals keep their own types. */
export class SiteShareExportFailure extends Error {
  readonly step: SiteShareExportStep;
  readonly appVersion: string | undefined;
  readonly jiniVersion: string | undefined;
  readonly time: string | undefined;

  constructor(required: { step: SiteShareExportStep; cause: unknown; appVersion?: string; jiniVersion?: string; time?: string }, _options = {}) {
    super(`Site export stopped during ${required.step}.`, { cause: required.cause });
    this.name = "SiteShareExportFailure";
    this.step = required.step;
    this.appVersion = required.appVersion;
    this.jiniVersion = required.jiniVersion;
    this.time = required.time;
  }
}

/** Closed stage descriptions: the route never infers storage trouble from an arbitrary exception. */
export const SITE_EXPORT_FAILURE_MESSAGES: Readonly<Record<SiteShareExportStep, string>> = {
  prepare: "The export stopped while preparing the site files.",
  archive: "The export stopped while building the ZIP.",
  delivery: "The export stopped while saving or delivering the ZIP.",
};
