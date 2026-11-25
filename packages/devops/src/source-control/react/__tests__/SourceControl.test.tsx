import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SourceControl, type SourceControlProps, type SourceControlTabBarProps } from "../SourceControl.js";

describe("SourceControl shell", () => {
  it.each(["providers", "stale-tab"])("renders only Providers and keeps the panel visible for %s", tabId => {
    const resolveActiveTabId = vi.fn<SourceControlProps["resolveActiveTabId"]>(() => "providers");
    const html = renderToStaticMarkup(<SourceControl
      classes={{ page: "fixture-page", pageHeader: "fixture-header", pageHeaderText: "fixture-header-text", pageKicker: "fixture-kicker", pageTitle: "fixture-title", pageDescription: "fixture-description" }}
      tabId={tabId}
      useAdminLocaleHook={() => "fixture-locale"}
      t={({ locale, key }) => key === "fixture.description" ? `${locale}: supplied description` : key}
      resolveActiveTabId={resolveActiveTabId}
      TabBar={({ tabs, activeId, ariaLabel }: SourceControlTabBarProps) => <nav aria-label={ariaLabel}>
        {tabs.map(tab => <button key={tab.id} data-tab-id={tab.id} data-active={activeId === tab.id} data-label={tab.handleLabel}>{tab.icon}{tab.label}</button>)}
      </nav>}
      onTabChange={() => {}}
      providerIcon={<svg data-provider-icon="fixture" />}
      providers={<section data-providers="fixture">Supplied providers panel</section>}
      headerAttrs={{ "data-agent-element": "fixture-header" }}
      copy={{ descriptionKey: "fixture.description", providerTabHandleLabel: "Fixture providers handle" }}
    />);
    expect(resolveActiveTabId).toHaveBeenCalledExactlyOnceWith({ tabId, validIds: ["providers"], defaultId: "providers" });
    expect(html.match(/data-tab-id=/g)).toHaveLength(1);
    expect(html).toContain('data-tab-id="providers" data-active="true"');
    expect(html).toContain('data-label="Fixture providers handle"');
    expect(html).toContain('<svg data-provider-icon="fixture"></svg>Providers</button>');
    expect(html).toContain('data-agent-element="fixture-header"');
    expect(html).toContain("fixture-locale: supplied description");
    expect(html).toContain('class="fixture-page"');
    expect(html).toContain('class="fixture-description"');
    expect(html).toContain('<section data-providers="fixture">Supplied providers panel</section>');
  });
});
