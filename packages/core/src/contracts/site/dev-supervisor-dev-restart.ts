/**
 * @file The dev restart-on-request port. Types only.
 *
 * After a site switch, a supervised dev server asks its supervisor to restart the API child onto
 * the new site. The server only writes a supervisor request; it never kills, signals or re-execs
 * itself. The port exists only under a dev supervisor, so unsupervised boots have no port and
 * callers fall back to restart instructions. The file-backed implementation stays with the host.
 */

export type DevRestartDecision = { accepted: true } | { accepted: false; reason: string };

export interface DevRestartPort {
  /** False when the launcher is pinned by an explicit shell site override. */
  canSwitchSite?: boolean;
  /** Legacy requests write after the chat delivery delay. Opt-in callers await the supervisor's
   * precheck; acceptance schedules a restart and does not claim a completed boot. */
  requestRestart(required: { reason: string }, optional?: { awaitAcceptance?: boolean }): void | Promise<DevRestartDecision | void>;
}
