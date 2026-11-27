import { describe, expect, it, vi } from "vitest";
import { createExportPreflight, findContactEmailPlaceholder, findThirdPartyScriptHosts, type ExportPreflightCopy } from "../export-preflight.js";

const copy: ExportPreflightCopy = {
  contactEmailPlaceholder: "FIXTURE CONTACT ADDRESS",
  placeholderWarning: ({ pages }) => pages ? `placeholder:${pages}` : undefined,
  thirdPartyWarning: ({ pages, hosts }) => pages ? `scripts:${pages}:${hosts.join(",")}` : undefined,
};

describe("export preflight", () => {
  it("uses the supplied placeholder", () => {
    expect(findContactEmailPlaceholder({ html: "<p>FIXTURE CONTACT ADDRESS</p>", placeholder: copy.contactEmailPlaceholder })).toBe(true);
    expect(findContactEmailPlaceholder({ html: "ADD YOUR CONTACT EMAIL", placeholder: copy.contactEmailPlaceholder })).toBe(false);
  });

  it("detects mixed-case scripts and skips relative, own-origin, declared and inert scripts", () => {
    const html = '<ScRiPt src="https://Z.example/a.js"></ScRiPt><script src="https://a.example/a.js"></script>'
      + '<script src="https://z.example/b.js"></script><script src="/local.js"></script>'
      + '<script src="https://own.example/a.js"></script><script data-jini-declared-script src="https://declared.example/a.js"></script>'
      + '<template><script src="https://inert.example/a.js"></script></template>';
    expect(findThirdPartyScriptHosts({ html, ownHosts: new Set(["own.example"]) })).toEqual(["a.example", "z.example"]);
  });

  it("keeps collectors independent and counts repeated observations with sorted, deduplicated hosts", () => {
    const first = createExportPreflight({ ownOrigins: ["https://own.example"], copy });
    const second = createExportPreflight({ ownOrigins: [], copy });
    const html = 'FIXTURE CONTACT ADDRESS<script src="https://z.example/a.js"></script><script src="https://a.example/a.js"></script>';
    first.observePage({ html });
    first.observePage({ html });
    first.setConsentConfigured({ configured: true });
    expect(first.joinWarnings({ existing: "existing" })).toBe("existing placeholder:2 scripts:2:a.example,z.example");
    expect(second.joinWarnings({ existing: undefined })).toBeUndefined();
    expect(second.joinWarnings({ existing: "" })).toBeUndefined();
  });

  it("does not call the third-party formatter when consent is off", () => {
    const thirdPartyWarning = vi.fn(copy.thirdPartyWarning);
    const collector = createExportPreflight({ ownOrigins: [], copy: { ...copy, thirdPartyWarning } });
    collector.observePage({ html: '<script src="https://external.example/a.js"></script>' });
    collector.setConsentConfigured({ configured: false });
    expect(collector.joinWarnings({ existing: "existing" })).toBe("existing");
    expect(thirdPartyWarning).not.toHaveBeenCalled();
  });
});

it("ignores unusable origin evidence and non-web scripts without losing third-party warnings", () => {
  const collector = createExportPreflight({ ownOrigins: [null, "https://[", "https://site.example:8443"], copy });
  collector.setConsentConfigured({ configured: true });
  collector.observePage({ html: '<script></script><script src="https://["></script><script src="ftp://archive.example/a.js"></script>'
    + '<script src="https://site.example:8443/own.js"></script><script src="https://site.example/other-port.js"></script>'
    + '<script src="http://external.example/tracker.js"></script>' });
  expect(collector.joinWarnings({ existing: undefined })).toBe("scripts:1:external.example,site.example");
});
