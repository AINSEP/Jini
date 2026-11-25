// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AdminByokKeyFooter, type AdminByokKeyFooterProps } from "../AdminByokKeyPanel.js";

afterEach(cleanup);

it("asks for the current provider's key instead of claiming the other endpoint's stored key", () => {
  const resolveByokFooterStatusLine: AdminByokKeyFooterProps["resolveByokFooterStatusLine"] =
    ({ isStored }, { storedKeyIsForOtherEndpoint, t = (key: string) => key } = {}) =>
      t(storedKeyIsForOtherEndpoint
        ? "Your saved key is for a different provider. Paste a key for this one."
        : isStored ? "Stored on the server, encrypted. Paste a new key to replace it." : "Paste your key, then press Save key.");
  const stored = { isSet: true, hint: "••••mw4w" };
  render(<AdminByokKeyFooter
    controller={{ saveState: { status: "idle" }, canSaveKey: false, stored, storedKeyIsForOtherEndpoint: true, saveKey: vi.fn(async () => {}) }}
    useAdminLocaleHook={() => "en"}
    createTranslator={() => ({ key }) => key}
    resolveByokFooterStatusLine={resolveByokFooterStatusLine}
  />);
  expect(screen.getByText("Your saved key is for a different provider. Paste a key for this one.")).toBeTruthy();
  expect(screen.queryByText(/Stored on the server/)).toBeNull();
  expect(screen.queryByText(/••••mw4w/)).toBeNull();
});
