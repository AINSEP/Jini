// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test } from "vitest";
import { sourceControlProviders } from "../rules.js";
import { ProvidersTab } from "../ProvidersTab.js";

test("descriptor order survives and a saved unlisted provider stays connected without a form", async () => {
  const providers = sourceControlProviders({ descriptors: [{ id: "second", label: "Second" }, { id: "first", label: "First" }], credentials: [{ providerId: "missing" }] });
  expect(providers.map(({ id }) => id)).toEqual(["second", "first", "missing"]);
  expect(providers[2]?.listed).toBe(false);
  const node = document.createElement("div");
  const root = createRoot(node);
  const saved = { id: "saved", providerId: "missing", label: "default", configured: true as const, isDefault: true, createdAt: "2026-11-25T00:00:00Z", updatedAt: "2026-11-25T00:00:00Z", tokenHint: { length: 12, last4: "1234" } };
  await act(async () => { root.render(<ProvidersTab useAdminLocaleHook={() => "en"} useSourceControlCredentialsHook={() => ({ rows: providers.map(info => ({ providerId: info.id, info, saved: info.id === "missing" ? saved : undefined, token: "", values: {}, readyToSave: false, saving: false, error: null })), loadError: null, providersNotice: null, setToken: () => {}, setField: () => {}, save: async () => {}, t: key => key })} navigate={() => {}} viewerTimeZone="UTC" CredentialHint={({ hint }) => <span>{hint?.last4}</span>} kit={{ SecretInput: () => <input />, Icon: () => null }} lineIcon={{ viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true }} fieldHelpText={() => undefined} fieldNameHandleSegment={({ fieldName }) => fieldName} copy={{ providersRegionLabel: "Connections", storedTokenHint: "Stored safely" }} />); });
  const rows = node.querySelectorAll("details[name='source-control-provider']");
  expect(rows).toHaveLength(3);
  expect(rows[2]?.textContent).toContain("missing connected");
  expect(rows[2]?.textContent).toContain("1234");
  expect(rows[2]?.querySelector("input")).toBeNull();
  expect(rows[2]?.querySelector("button")).toBeNull();
  await act(async () => { root.unmount(); });
});
