import { expect, it } from "vitest";
import { bodyParseRefusal, installedAgentPluginRow, knownInstallRefusal, type InstallLifecycleErrorPredicates } from "../install-response.js";

class UpdateError extends Error { readonly code = "AGENT_PLUGIN_UPDATE_DIGEST_MISMATCH"; }
class BusyError extends Error {}
class HostUploadError extends Error { constructor(readonly code: string, message: string) { super(message); } }
class HostInstallError extends Error { constructor(readonly code: string) { super("/srv/host/path/plugin.json"); } }

const lifecycleErrors: InstallLifecycleErrorPredicates = {
  update: (error): error is UpdateError => error instanceof UpdateError,
  hostIncompatible: (_error): _error is UpdateError => false,
  activationsUnreadable: (_error): _error is Error => false,
  activationsBusy: (error): error is BusyError => error instanceof BusyError,
};
const classifyHostError = ({ error }: { error: unknown }) => error instanceof HostUploadError ? { kind: "upload" as const, code: error.code, message: error.message }
  : error instanceof HostInstallError ? { kind: "install" as const, code: error.code, message: error.message } : undefined;
const refuse = (error: unknown) => knownInstallRefusal({ error, classifyHostError, lifecycleErrors });

it("keeps parser, archive and lifecycle refusal bodies stable without exposing warnings", () => {
  expect(bodyParseRefusal({ parseError: { type: "entity.too.large" } })).toEqual({ status: 413, body: { code: "AGENT_PLUGIN_ARCHIVE_TOO_LARGE", error: "The .zip is larger than the 32 MiB limit." } });
  expect(bodyParseRefusal({ parseError: null })).toEqual({ status: 400, body: { code: "AGENT_PLUGIN_ARCHIVE_UNREADABLE", error: "The upload could not be read." } });
  expect(refuse(new UpdateError("changed since you looked"))).toEqual({ status: 409, body: { code: "AGENT_PLUGIN_UPDATE_DIGEST_MISMATCH", error: "changed since you looked" } });
  expect(refuse(new HostUploadError("PLUGIN_ID_TAKEN", "raw"))).toEqual({ status: 409, body: { code: "AGENT_PLUGIN_PLUGIN_ID_TAKEN", error: "This plugin ID is already installed. Choose Replace existing version to upgrade it." } });
  expect(refuse(new HostUploadError("ARCHIVE_UNREADABLE", "raw"))?.status).toBe(400);
  expect(refuse(new HostUploadError("OTHER", "own message"))?.body.error).toBe("own message");
  expect(refuse(new HostInstallError("ARCHIVE_TOO_LARGE"))?.status).toBe(413);
  expect(refuse(new HostInstallError("PUBLISH_FAILED"))?.status).toBe(500);
  const unknownInstall = refuse(new HostInstallError("SYMLINK"));
  expect(unknownInstall).toEqual({ status: 400, body: { code: "AGENT_PLUGIN_SYMLINK", error: "This .zip contains files or links that plugins may not include." } });
  const busy = refuse(new BusyError("lock at /srv/host/activations.lock"));
  expect(busy?.body).toEqual({ code: "AGENT_PLUGIN_ACTIVATIONS_BUSY", error: "Could not install the plugin. Try again." });
  expect(JSON.stringify(busy?.body)).not.toContain("/srv/host");
  expect(busy?.warning).toContain("/srv/host/activations.lock");
  expect(refuse(new Error("private driver detail"))).toBeUndefined();
});

it("builds the installed row from named fields only", () => {
  const candidate = { pluginId: "p", keywords: ["k"], enabled: true, skills: [], mcpServerIds: ["m"], displayName: "P", hostPath: "/srv/secret", origin: "uploaded" };
  const row = installedAgentPluginRow({ candidate });
  expect(row).toMatchObject({ pluginId: "p", displayName: "P", summary: null, version: null, description: null, keywords: ["k"], enabled: true, mcpServerIds: ["m"], origin: "uploaded" });
  expect(JSON.stringify(row)).not.toContain("/srv/secret");
  expect(installedAgentPluginRow({ candidate: undefined })).toBeNull();
});
