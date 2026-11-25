import { agentHandle } from "@jini-ai/core/agent-handles";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HistoryTab } from "../index.js";

describe("HistoryTab", () => {
  it("renders a heading and real empty state with the supplied publish link and stable handles", () => {
    const html = renderToStaticMarkup(<HistoryTab
      classes={{ tab: "deployment-tab", card: "card", empty: "deployment-empty", mark: "deployment-empty-mark", title: "deployment-empty-title", body: "deployment-empty-body", secondaryButton: "btn-secondary" }}
      useAdminLocaleHook={() => "en"}
      t={({ key }) => key}
      historyIcon={<svg data-history-icon="fixture" />}
      publishHref="/fixture/publish?tab=export"
      agentHandle={agentHandle}
    />);
    expect(html).toContain('<h2 class="deployment-empty-title">No deploys yet</h2>');
    expect(html).not.toMatch(/<(?:table|tr|li)(?:\s|>)/);
    expect(html).toContain('data-agent-element="deployment-history-empty"');
    expect(html).toContain('data-agent-element="deployment-history-publish-link"');
    expect(html).toContain('href="/fixture/publish?tab=export"');
    expect(html).toContain('<span class="deployment-empty-mark"><svg data-history-icon="fixture"></svg></span>');
  });
});

it("history, success and a failed run use the bound layout roles", () => {
  for (const host of ['host-a', 'host-b']) {
    const classes = { tab: `${host}-tab`, card: `${host}-card`, empty: `${host}-empty`, mark: `${host}-mark`, title: `${host}-title`, body: `${host}-body`, secondaryButton: `${host}-button` };
    const html = renderToStaticMarkup(<HistoryTab classes={classes} useAdminLocaleHook={() => 'en'} t={({ key }) => key} historyIcon="+" publishHref="/publish" agentHandle={agentHandle} />);
    for (const token of Object.values(classes)) expect(html).toContain(`class="${token}"`);
    expect(html).toContain('href="/publish"');
    expect(html).toContain('No deploys yet');
  }
});
