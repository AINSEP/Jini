// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { guideToPendingCredentialCard, onAdminSecretRedacted } from "../credential-card-guidance.js";

afterEach(() => { document.body.replaceChildren(); });

it("scrolls the unique pending credential card's wrapper and moves focus to its iframe", () => {
  document.body.innerHTML = '<article class="surface"><span data-agent-element="mcp-ui-pending-service-secret-card"></span><iframe title="Use secure form"></iframe></article>';
  const wrapper = document.querySelector("article")!;
  const scrollIntoView = vi.fn();
  Object.assign(wrapper, { scrollIntoView });
  onAdminSecretRedacted({ secretRedacted: true, count: 1 }, { cardWrapperSelector: ".surface" });
  expect(scrollIntoView.mock.calls).toEqual([[{ block: "center", behavior: "smooth" }]]);
  expect(document.activeElement).toBe(wrapper.querySelector("iframe"));
});

it("uses the card itself without a wrapper and refuses to pick between multiple pending cards", () => {
  document.body.innerHTML = '<div data-agent-element="mcp-ui-pending-first-secret-card"></div>';
  const card = document.querySelector("div")!;
  const scrollIntoView = vi.fn();
  Object.assign(card, { scrollIntoView });
  expect(guideToPendingCredentialCard({ document, cardWrapperSelector: ".absent" })).toBe(true);
  expect(scrollIntoView.mock.calls).toEqual([[{ block: "center", behavior: "smooth" }]]);
  const second = card.cloneNode();
  document.body.append(second);
  expect(guideToPendingCredentialCard({ document, cardWrapperSelector: ".absent" })).toBe(false);
  expect(scrollIntoView).toHaveBeenCalledOnce();
  card.remove();
  second.remove();
  expect(guideToPendingCredentialCard({ document, cardWrapperSelector: ".absent" })).toBe(false);
});

it("does not use the ambient page when the host explicitly has no document", () => {
  document.body.innerHTML = '<div data-agent-element="mcp-ui-pending-first-secret-card"></div>';
  const scrollIntoView = vi.fn();
  Object.assign(document.querySelector("div")!, { scrollIntoView });
  onAdminSecretRedacted({ secretRedacted: true, count: 1 }, { document: null, cardWrapperSelector: ".absent" });
  expect(scrollIntoView).not.toHaveBeenCalled();
});
