import type { Translate } from "@jini-ai/core/text";
import { describeApiError } from "../rules.js";
import type { UsersDependencies } from "./use-users.hooks.js";
import { useUsersRoster as useUsersRosterDefault, useUsersCallerState as useUsersCallerStateDefault, useUsersRename as useUsersRenameDefault } from "./use-users-roster.hooks.js";
import { createUsersCapabilities } from "./use-users-roster.hooks.js";
import { useUsersCreationState as useUsersCreationStateDefault, useUsersGrantState as useUsersGrantStateDefault, useUsersStatusState as useUsersStatusStateDefault } from "./use-users-form-state.hooks.js";

export function createUsersErrorDescriber(translate: Translate) {
  return (error: unknown, fallback: string) => describeApiError({ error, fallback, translate });
}

export function useUsersState(deps: UsersDependencies, { useUsersRoster = useUsersRosterDefault, useUsersCreationState = useUsersCreationStateDefault, useUsersGrantState = useUsersGrantStateDefault, useUsersStatusState = useUsersStatusStateDefault, useUsersCallerState = useUsersCallerStateDefault, useUsersRename = useUsersRenameDefault }: { useUsersRoster?: typeof useUsersRosterDefault; useUsersCreationState?: typeof useUsersCreationStateDefault; useUsersGrantState?: typeof useUsersGrantStateDefault; useUsersStatusState?: typeof useUsersStatusStateDefault; useUsersCallerState?: typeof useUsersCallerStateDefault; useUsersRename?: typeof useUsersRenameDefault } = {}) {
  const describeError = createUsersErrorDescriber(deps.translate);
  const roster = useUsersRoster({ ...deps, describeError });
  const creation = useUsersCreationState(deps);
  const grant = useUsersGrantState(deps);
  const status = useUsersStatusState(deps);
  const caller = useUsersCallerState({ portRef: roster.portRef });
  const capabilities = createUsersCapabilities({ ...roster, ...caller });
  const rename = useUsersRename({ ...deps, ...capabilities });
  return { ...deps, describeError, ...roster, ...creation, ...grant, ...status, ...caller, ...capabilities, ...rename };
}
