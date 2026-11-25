import { useFetchMutation } from "../../react/kit.js";
import { KEYS } from "../rules.js";
import type { useRolesState } from "./use-roles-state.hooks.js";

export function useRolesMutations(
  { port }:
    Pick<ReturnType<typeof useRolesState>, "port">,
  _optional: Record<string, never> = {},
) {
  const createRoleMutation = useFetchMutation({
    run: ({ input: name }: { input: string }) => port.createRole({ name }),
  }, {
    invalidates: [KEYS.list],
  });
  const createPolicyMutation = useFetchMutation({
    run: ({ input }: { input: { name: string; description: string | undefined } }) =>
      port.createPolicy({ name: input.name }, { description: input.description }),
  }, {
    invalidates: [KEYS.list],
  });
  const saveRoleMutation = useFetchMutation({
    run: ({ input }: { input: { roleId: string; name: string; expectedVersion: number | undefined } }) => port.updateRole(input),
  }, {
    invalidates: [KEYS.list],
  });
  const deleteRoleMutation = useFetchMutation({
    run: ({ input: id }: { input: string }) => port.deleteRole({ roleId: id }),
  }, {
    invalidates: [KEYS.list],
  });
  const savePolicyMutation = useFetchMutation({
    run: ({ input }: { input: { policyId: string; name: string; description: string; expectedVersion: number | undefined } }) =>
      port.updatePolicy({ policyId: input.policyId }, { name: input.name, description: input.description, expectedVersion: input.expectedVersion }),
  }, {
    invalidates: [KEYS.list],
  });
  const deletePolicyMutation = useFetchMutation({
    run: ({ input: id }: { input: string }) => port.deletePolicy({ policyId: id }),
  }, {
    invalidates: [KEYS.list],
  });
  // No `invalidates` — matches the pre-migration `onWritePermission`, which never called `reload()`
  // either.
  const writePermissionMutation = useFetchMutation({
    run: ({ input }: { input: { policyId: string; permission: string; resourceType: string | undefined } }) =>
      port.writePolicyPermission({ policyId: input.policyId, permission: input.permission }, { resourceType: input.resourceType }),
  });
  // Also no `invalidates`: removing a permission changes nothing `KEYS.list` caches (the policy
  // list carries no permissions), so the refresh that matters is `loadPermissions` below.
  const removePermissionMutation = useFetchMutation({
    run: ({ input }: { input: { policyId: string; policyPermissionId: string } }) => port.removePolicyPermission(input),
  });
  return {
    createRoleMutation, createPolicyMutation, saveRoleMutation, deleteRoleMutation, savePolicyMutation, deletePolicyMutation, writePermissionMutation,
    removePermissionMutation,
  };
}
