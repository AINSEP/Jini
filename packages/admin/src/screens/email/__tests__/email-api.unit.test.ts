import { describe, expect, it } from "vitest";
import { createEmailApi, type EmailApiDeps } from "../email-api.js";
import { createMailStatusApi, type MailStatusApiDeps } from "../api/mail-status-api.js";
import type { AdminMailStatus } from "../api/mail-status-api.types.js";
import type { EmailApi } from "../email-api.types.js";

type Request = Parameters<EmailApiDeps["authenticatedAdminRequest"]>[0];
const root = "/workspaces/work-29";
const system = `${root}/system`;
const templates = `${root}/email-templates`;
const id = "res/end#1";
const encoded = "res%2Fend%231";
const credential = { username: "operator", token: "test-fixture", baseUrl: "https://mail.example.test" };
const remove = { address: "admin+test@example.test", scope: "bulk" as const, reason: "Wrong bounce attribution" };
const values = { customer: "Ada" };
const html = "<p>Hello {{customer}}</p>";

interface Scenario {
  name: string;
  request: Request;
  invoke: (api: ReturnType<typeof createEmailApi>) => Promise<unknown>;
}
const scenarios = [
  { name: "provider listing", request: { method: "GET", path: `${system}/mail-providers` }, invoke: api => api.listProviders() },
  { name: "save provider key", request: { method: "PUT", path: `${system}/mail-providers/${encoded}/credential`, body: credential }, invoke: api => api.saveProviderKey({ providerId: id, input: credential }) },
  { name: "activate provider", request: { method: "POST", path: `${system}/mail-providers/${encoded}/activate`, body: {} }, invoke: api => api.activateProvider({ providerId: id }) },
  { name: "DNS status", request: { method: "GET", path: `${system}/mail-dns` }, invoke: api => api.readDns() },
  { name: "verify DNS", request: { method: "POST", path: `${system}/mail-dns/verify`, body: {} }, invoke: api => api.verifyDns() },
  { name: "default recipient", request: { method: "POST", path: `${system}/mail-test-send`, body: { requestId: "key-6" } }, invoke: api => api.sendTest({ requestId: "key-6" }) },
  { name: "explicit recipient", request: { method: "POST", path: `${system}/mail-test-send`, body: { requestId: "key-7", to: "ada@example.test" } }, invoke: api => api.sendTest({ to: "ada@example.test", requestId: "key-7" }) },
  { name: "uses report", request: { method: "GET", path: `${system}/mail-uses` }, invoke: api => api.readUses() },
  { name: "unfiltered activity", request: { method: "GET", path: `${system}/mail-activity` }, invoke: api => api.listActivity({ filter: { recipient: "" } }) },
  { name: "filtered activity page", request: { method: "GET", path: `${system}/mail-activity?outcome=bounced&recipient=ada%2Bops%40example.test&cursor=p%2F2` }, invoke: api => api.listActivity({ filter: { outcome: "bounced", recipient: "ada+ops@example.test" }, cursor: "p/2" }) },
  { name: "activity details", request: { method: "GET", path: `${system}/mail-activity/${encoded}` }, invoke: api => api.getActivity({ id }) },
  { name: "suppression search", request: { method: "GET", path: `${system}/mail-suppressions?search=some+address&cursor=next%2B` }, invoke: api => api.listSuppressions({ search: "some address", cursor: "next+" }) },
  { name: "plan suppression removal", request: { method: "POST", path: `${system}/mail-suppressions/remove`, body: remove }, invoke: api => api.removeSuppression(remove) },
  { name: "confirm suppression removal", request: { method: "POST", path: `${system}/mail-suppressions/remove`, body: { ...remove, confirmed: true, revision: "rev-4" } }, invoke: api => api.removeSuppression(remove, { confirm: { revision: "rev-4" } }) },
  { name: "plan capture clear", request: { method: "POST", path: `${system}/mail-capture/clear`, body: {} }, invoke: api => api.clearCaptured() },
  { name: "confirm capture clear", request: { method: "POST", path: `${system}/mail-capture/clear`, body: { confirmed: true, revision: "same-plan-2" } }, invoke: api => api.clearCaptured({ confirm: { revision: "same-plan-2" } }) },
  { name: "feedback setup", request: { method: "GET", path: `${system}/mail-feedback` }, invoke: api => api.readFeedback() },
  { name: "template listing", request: { method: "GET", path: `${templates}?limit=100` }, invoke: api => api.listTemplates() },
  { name: "create template", request: { method: "POST", path: templates, body: { name: "Welcome" } }, invoke: api => api.createTemplate({ name: "Welcome" }) },
  { name: "read template", request: { method: "GET", path: `${templates}/${encoded}` }, invoke: api => api.getTemplate({ id }) },
  { name: "save template HTML", request: { method: "PUT", path: `${templates}/${encoded}/html`, body: { html, expectedVersion: 3 } }, invoke: api => api.saveTemplateHtml({ id, html, expectedVersion: 3 }) },
  { name: "rename template", request: { method: "PATCH", path: `${templates}/${encoded}`, body: { name: "Launch", expectedVersion: 6 } }, invoke: api => api.renameTemplate({ id, name: "Launch", expectedVersion: 6 }) },
  { name: "preview delivered HTML", request: { method: "POST", path: `${templates}/preview`, body: { html, values, mode: "sent" } }, invoke: api => api.previewTemplate({ html, values, mode: "sent" }) },
  { name: "trash template", request: { method: "POST", path: `${root}/trash/items`, body: { type: "email-template", id } }, invoke: api => api.trashTemplate({ id }) },
  { name: "read sender", request: { method: "GET", path: `${root}/settings/effective?namespace=core.mail` }, invoke: api => api.readSender() },
  { name: "save sender", request: { method: "PUT", path: `${root}/settings/value`, body: { namespace: "core.mail", scope: "workspace", key: "senderName", valueJson: "Example sender" } }, invoke: api => api.saveSender({ key: "senderName", value: "Example sender" }) },
] satisfies Scenario[];

describe("email API transport contracts", () => {
  it.each(scenarios)("sends exactly the workspace request for $name", async ({ name, invoke, request }) => {
    const calls: Request[] = [];
    const response = { acknowledgment: name };
    const authenticatedAdminRequest: EmailApiDeps["authenticatedAdminRequest"] = async <T,>(input: Request): Promise<T> => {
      calls.push(input);
      expect(input).toStrictEqual(request);
      return response as T;
    };
    await expect(invoke(createEmailApi({ workspaceId: "work-29", authenticatedAdminRequest }))).resolves.toEqual(response);
    expect(calls).toEqual([request]);
  });

  it("preserves an authentication refusal from the host transport", async () => {
    const failure = Object.assign(new Error("Session expired"), { status: 401 });
    const api: EmailApi = createEmailApi({ workspaceId: "work-29", authenticatedAdminRequest: async () => { throw failure; } });
    await expect(api.readSender()).rejects.toBe(failure);
  });

  it("reads and preserves the workspace mail delivery verdict for settings consumers", async () => {
    const result: AdminMailStatus = {
      mailDeliveryAvailable: false, state: "unconfigured",
      lanes: [{ lane: "transactional", providerId: null, state: "unconfigured" }],
    };
    const calls: unknown[][] = [];
    const request: MailStatusApiDeps["request"] = async <T,>(...args: Parameters<MailStatusApiDeps["request"]>): Promise<T> => {
      calls.push(args);
      return result as T;
    };
    await expect(createMailStatusApi({ request, workspaceId: "other-92" }).getMailStatus()).resolves.toEqual(result);
    expect(calls).toEqual([[{ path: "/workspaces/other-92/system/mail-status" }]]);
  });
});
