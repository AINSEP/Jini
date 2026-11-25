import { agentHandle } from "@jini-ai/core/agent-handles";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HistoryTab } from "../index.js";

describe("HistoryTab", () => {
  it("renders a heading and real empty state with the supplied publish link and stable handles", () => {
    const html = renderToStaticMarkup(<HistoryTab
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
