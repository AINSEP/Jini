import type { UsersController as JiniController } from "./hooks/use-users.hooks.js";
import type { WiredUsersHook } from "./hooks/use-localized-users.hooks.js";

/** Adapt Tovu's injected controller to Jini's existing hook seam. */
export function createUsersControllerHook({ useUsersHook, openOwnPasswordReset }: { useUsersHook: WiredUsersHook; openOwnPasswordReset?: boolean | undefined }, _options = {}) {
  function useController(_required = {}, _options = {}): JiniController {
    const controller = useUsersHook({ openOwnPasswordReset });
    return { ...controller, translate: controller.t };
  }
  return useController;
}
