/** Bind Electron/native effects and host callbacks to Jini's update coordinator. */
// Update lifecycle rationale: Jini/packages/desktop-host/src/electron/updates/auto-update-controller.ts.
import {
  createAutoUpdateController as createController,
  createElectronUpdaterAdapter,
} from "../electron/updates/index.js";
import type { AutoUpdateController, ElectronUpdater } from "../electron/updates/index.js";
import { createInstancePresence } from "./instance-presence.js";

interface AutoUpdateControllerDeps {
  updater: ElectronUpdater;
  platform: NodeJS.Platform;
  pid: number;
  presenceDir: string;
  now: () => number;
  isAlive?: (required: { pid: number }) => boolean;
  promptUpdateReady: (required: { version: string }) => Promise<boolean>;
  explainOthersOpen: (required: { count: number }) => void;
  /** Normal app.quit(), including the site drain; updater restart must use the same shutdown path. */
  quit: () => void;
  log: (required: { message: string }) => void;
  stageTimeoutMs?: number;
}

/** Keep host callbacks stable and inject the host's presence and clock.
 * Jini defaults preserve the timing and log wording, including the two-minute macOS Squirrel
 * handoff deadline: quit without the update if staging hangs. A host may override that deadline.
 * main.ts constructs this only for eligible packaged/non-Store builds and calls beforeFinalQuit
 * after the site drain; a true result means preventDefault while the installer takes over quitting.
 * @complexity O(1) construction; O(n) instances per tick.
 */
function createAutoUpdateController(deps: AutoUpdateControllerDeps): AutoUpdateController {
  const isAlive = deps.isAlive;
  return createController({
    updater: createElectronUpdaterAdapter({ updater: deps.updater }),
    platform: deps.platform,
    pid: deps.pid,
    presence: createInstancePresence({ directory: deps.presenceDir },
      isAlive ? { isAlive } : {}),
    clock: { nowMs: deps.now },
    promptUpdateReady: ({ version }) => deps.promptUpdateReady({ version }),
    explainOthersOpen: ({ count }) => deps.explainOthersOpen({ count }),
    quit: deps.quit,
    log: ({ message }) => deps.log({ message }),
  }, deps.stageTimeoutMs === undefined ? {} : { timing: { stageTimeoutMs: deps.stageTimeoutMs } });
}

export { createAutoUpdateController };
export type { AutoUpdateController, AutoUpdateControllerDeps };
