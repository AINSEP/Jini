/**
 * @file Pins the newsletter data-module factory against the exact manifest the host declared
 * before the move. The stored provenance is compared on every boot, so a factory that drifted by
 * one column, flag or provenance field would turn every repeat boot into a consent-required refusal.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { DataModuleDecl } from "@jini-ai/core/contracts/site/db-data-modules";
import {
  createNewsletterDataModule,
  installNewsletterDataModule,
  NEWSLETTER_PLUGIN_ID,
  NEWSLETTER_TABLE_NAMES,
} from "../data-module-manifest.js";

/** The host's pre-move `NEWSLETTER_DATA_MODULE` constant, serialized before the edit. */
const PRE_MOVE = JSON.parse(
  readFileSync(new URL("./fixtures/newsletter-data-module.pre-move.json", import.meta.url), "utf8")
) as DataModuleDecl;

describe("createNewsletterDataModule", () => {
  it("with the host's stored publisher deep-equals the pre-move constant", () => {
    expect(createNewsletterDataModule({ publisher: PRE_MOVE.provenance.publisher })).toStrictEqual(PRE_MOVE);
  });

  it("stores the given publisher and keeps the fixed builtin source URL", () => {
    const decl = createNewsletterDataModule({ publisher: "example-publisher" });
    expect(decl.provenance).toStrictEqual({ sourceUrl: "builtin://newsletter", publisher: "example-publisher" });
    expect(decl.pluginId).toBe(NEWSLETTER_PLUGIN_ID);
  });

  it("names every table with the p_{pluginId}__ prefix", () => {
    expect(NEWSLETTER_TABLE_NAMES).toStrictEqual({
      lists: "p_newsletter__lists",
      subscriptions: "p_newsletter__subscriptions",
      audienceSnapshots: "p_newsletter__audience_snapshots",
      sends: "p_newsletter__sends",
      confirmationTokens: "p_newsletter__confirmation_tokens",
    });
  });
});

describe("installNewsletterDataModule", () => {
  it("declares the manifest built from the given publisher on the given store", async () => {
    const declareDataModule = vi.fn(async () => ({ ok: true }));
    const db = { kind: "store" };
    await installNewsletterDataModule({ db, dbPath: "/x.db", publisher: "example-publisher", declareDataModule });
    expect(declareDataModule).toHaveBeenCalledWith({
      db,
      dbPath: "/x.db",
      decl: createNewsletterDataModule({ publisher: "example-publisher" }),
    });
  });

  it("throws with the declare error code and message when the declaration fails", async () => {
    const declareDataModule = async () => ({ ok: false, error: { code: "consent-required", message: "publisher changed" } });
    await expect(
      installNewsletterDataModule({ db: {}, dbPath: "/x.db", publisher: "example-publisher", declareDataModule })
    ).rejects.toThrow("newsletter dataModule declaration failed: consent-required — publisher changed");
  });
});
