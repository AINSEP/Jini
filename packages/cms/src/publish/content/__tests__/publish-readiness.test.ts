import { describe, expect, it } from "vitest";

import { describePublishReadiness, type PublishReadinessCopy } from "../publish-readiness.js";

/**
 * @file The readiness decision over host-supplied copy: check order, the verdict/ready flag per
 * branch, and that every sentence comes from the injected copy (none is authored here).
 */

const copy: PublishReadinessCopy = {
  nothingPublishable: { summary: "S-empty", missing: "M-empty", nextStep: "N-empty" },
  publishesTo: ({ siteLabels }) => `TO[${siteLabels.join("|")}]`,
  notConnected: ({ siteLabel }) => ({ summary: `S-nc ${siteLabel}`, missing: `M-nc ${siteLabel}`, nextStep: `N-nc ${siteLabel}` }),
  noLiveSite: { summary: "S-none", missing: "M-none", nextStep: "N-none" },
};
const base = { connectedSiteLabel: null, otherSiteLabels: [], candidateUrl: null, publishableTypeCount: 2, copy };

describe("describePublishReadiness", () => {
  it("checks nothing-publishable first, even when a site is connected", () => {
    expect(describePublishReadiness({ ...base, connectedSiteLabel: "a.com", publishableTypeCount: 0 })).toEqual({ ready: false, verdict: "nothing-publishable", summary: "S-empty", missing: "M-empty", nextStep: "N-empty" });
  });

  it("a connected site or hand-configured sites are ready, worded by the host formatter", () => {
    expect(describePublishReadiness({ ...base, connectedSiteLabel: "a.com", otherSiteLabels: ["b.com"] })).toEqual({ ready: true, verdict: "ready", summary: "TO[a.com]", missing: null, nextStep: null });
    expect(describePublishReadiness({ ...base, otherSiteLabels: ["b.com", "c.com"] })).toEqual({ ready: true, verdict: "ready", summary: "TO[b.com|c.com]", missing: null, nextStep: null });
  });

  it("a candidate address is not-connected under its host label; nothing at all is no-live-site", () => {
    expect(describePublishReadiness({ ...base, candidateUrl: "https://Example.com/x" })).toEqual({ ready: false, verdict: "not-connected", summary: "S-nc example.com", missing: "M-nc example.com", nextStep: "N-nc example.com" });
    expect(describePublishReadiness(base)).toEqual({ ready: false, verdict: "no-live-site", summary: "S-none", missing: "M-none", nextStep: "N-none" });
  });
});

it("uses the configured label verbatim if the candidate address cannot be parsed", () => {
  expect(describePublishReadiness({ ...base, candidateUrl: "Example remote site" })).toEqual({
    ready: false, verdict: "not-connected", summary: "S-nc Example remote site",
    missing: "M-nc Example remote site", nextStep: "N-nc Example remote site",
  });
});
