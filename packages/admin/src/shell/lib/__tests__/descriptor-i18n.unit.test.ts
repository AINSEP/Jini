import { describe, expect, it } from "vitest";

import type { AdminPublishTargetDescriptor } from "../../../deployment/api/deployment-api.types.js";
import type { AdminSourceControlProviderDescriptor } from "../../../source-control/api/source-control-api.types.js";
import { descriptorText, localizePublishTargets, localizeSourceControlProviders } from "../descriptor-i18n.js";

/**
 * @file A plugin descriptor's own text in the viewer's locale, from the `i18n` block the plugin ships
 * (`{ locale: { English: translation } }`), falling back to the English it declares.
 */

const I18N = { es: { Owner: "Propietario" }, pt: { Owner: "Dono" }, "pt-BR": { Owner: "Proprietário" } };

describe("descriptorText", () => {
  it("uses the exact locale's translation", () => {
    expect(descriptorText({ i18n: I18N, locale: "es", english: "Owner" })).toBe("Propietario");
    expect(descriptorText({ i18n: I18N, locale: "pt-BR", english: "Owner" })).toBe("Proprietário");
  });

  it("falls back to the base language, then to the English", () => {
    expect(descriptorText({ i18n: I18N, locale: "pt-PT", english: "Owner" })).toBe("Dono");
    expect(descriptorText({ i18n: I18N, locale: "de", english: "Owner" })).toBe("Owner");
    expect(descriptorText({ i18n: I18N, locale: "es", english: "Branch" })).toBe("Branch");
    expect(descriptorText({ i18n: undefined, locale: "es", english: "Owner" })).toBe("Owner");
  });
});

describe("localizePublishTargets", () => {
  const target: AdminPublishTargetDescriptor = {
    id: "github-pages",
    label: "GitHub Pages",
    configFields: [{ name: "owner", label: "Owner", required: true, help: "agent hint", userHelp: "person hint" }],
    projectName: { label: "Commit message", help: "Used as the commit message." },
    credential: {
      vendorLabel: "the storage provider",
      help: "Needs a token.",
      userHelp: "Get a token first.",
      tokenField: "token",
      tokenPageUrl: "https://example.com/tokens",
      fields: [{ name: "token", label: "Access token", required: true, secret: true }],
    },
    i18n: {
      es: {
        Owner: "Propietario",
        "person hint": "pista",
        "Commit message": "Mensaje de commit",
        "the storage provider": "el proveedor de almacenamiento",
        "Needs a token.": "Necesita un token.",
        "Get a token first.": "Consigue un token primero.",
        "Access token": "Token de acceso",
      },
    },
  };

  it("translates every person-facing string and leaves ids, names and URLs alone", () => {
    const [localized] = localizePublishTargets({ targets: [target], locale: "es" })!;
    expect(localized).toEqual({
      ...target,
      configFields: [{ name: "owner", label: "Propietario", required: true, help: "agent hint", userHelp: "pista" }],
      projectName: { label: "Mensaje de commit", help: "Used as the commit message." },
      credential: {
        vendorLabel: "el proveedor de almacenamiento",
        help: "Necesita un token.",
        userHelp: "Consigue un token primero.",
        tokenField: "token",
        tokenPageUrl: "https://example.com/tokens",
        fields: [{ name: "token", label: "Token de acceso", required: true, secret: true }],
      },
    });
  });

  it("adds no optional keys a minimal descriptor did not declare", () => {
    const bare: AdminPublishTargetDescriptor = {
      id: "static-host",
      label: "Static host",
      configFields: [{ name: "bucket", label: "Bucket", required: true }],
      i18n: { es: { "Static host": "Alojamiento estático", Bucket: "Depósito" } },
    };
    expect(localizePublishTargets({ targets: [bare], locale: "es" })).toStrictEqual([
      { ...bare, label: "Alojamiento estático", configFields: [{ name: "bucket", label: "Depósito", required: true }] },
    ]);
    const sparse: AdminPublishTargetDescriptor = {
      ...bare,
      projectName: { label: "Bucket" },
      credential: { tokenField: "token", fields: [{ name: "token", label: "Access token", required: true, secret: true }] },
    };
    const [localized] = localizePublishTargets({ targets: [sparse], locale: "es" })!;
    expect(localized!.projectName).toStrictEqual({ label: "Depósito" });
    expect(localized!.credential).toStrictEqual({ tokenField: "token", fields: [{ name: "token", label: "Access token", required: true, secret: true }] });
  });

  it("returns the descriptors unchanged in English, and undefined while not loaded", () => {
    expect(localizePublishTargets({ targets: [target], locale: "en" })).toEqual([target]);
    expect(localizePublishTargets({ targets: undefined, locale: "es" })).toBeUndefined();
  });
});

describe("localizeSourceControlProviders", () => {
  it("translates the host's guidance and field labels", () => {
    const provider: AdminSourceControlProviderDescriptor = {
      id: "github",
      label: "GitHub",
      credential: { help: "Needs a fine-grained token.", tokenField: "token", fields: [{ name: "token", label: "Access token", required: true, secret: true }] },
      i18n: { de: { "Needs a fine-grained token.": "Benötigt ein Token.", "Access token": "Zugriffstoken" } },
    };
    expect(localizeSourceControlProviders({ providers: [provider], locale: "de" })).toEqual([
      {
        ...provider,
        credential: { help: "Benötigt ein Token.", tokenField: "token", fields: [{ name: "token", label: "Zugriffstoken", required: true, secret: true }] },
      },
    ]);
  });

  it("leaves a host with no credential spec without one", () => {
    const provider: AdminSourceControlProviderDescriptor = { id: "local-git", label: "Local Git", i18n: { de: { "Local Git": "Lokales Git" } } };
    expect(localizeSourceControlProviders({ providers: [provider], locale: "de" })).toStrictEqual([{ ...provider, label: "Lokales Git" }]);
  });
});
