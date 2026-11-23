// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { enabledComposerButton, useComposerSendStopGuard } from "../hooks/use-composer-send-stop-guard.hooks.js";

afterEach(cleanup);

/** Two composers, each with a Send/Stop button the test can flip, plus controls the guard must ignore. */
function GuardHarness({ now }: { now: () => number }) {
  const guard = useComposerSendStopGuard({}, { now });
  return (
    <div onClickCapture={guard}>
      <div className="jini-composer">
        <button className="jini-composer-send" aria-label="first send" />
        <button className="jini-composer-send" aria-label="first disabled send" disabled />
        <button className="other" aria-label="first other" />
      </div>
      <div className="jini-composer">
        <button className="jini-composer-send" aria-label="second send" />
      </div>
      <button className="jini-composer-send" aria-label="loose send" />
    </div>
  );
}

function mount() {
  const clock = { value: 0 };
  render(<GuardHarness now={() => clock.value} />);
  return clock;
}

function button(name: string) {
  return screen.getByRole("button", { name });
}

function toStop(element: HTMLElement) {
  element.classList.add("jini-composer-send--stop");
}

/** fireEvent.click returns false exactly when a handler called preventDefault. */
function clickAllowed(element: HTMLElement, detail: number) {
  return fireEvent.click(element, { detail });
}

it("blocks a pointer Stop in the same composer inside the grace window", () => {
  const clock = mount();
  clickAllowed(button("first send"), 1);
  toStop(button("first send"));
  clock.value = 499;
  expect(clickAllowed(button("first send"), 1)).toBe(false);
});

it("allows a single-click Stop once the grace window has passed", () => {
  const clock = mount();
  clickAllowed(button("first send"), 1);
  toStop(button("first send"));
  clock.value = 500;
  expect(clickAllowed(button("first send"), 1)).toBe(true);
});

it("blocks a double-click Stop even after the grace window", () => {
  const clock = mount();
  clickAllowed(button("first send"), 1);
  toStop(button("first send"));
  clock.value = 5_000;
  expect(clickAllowed(button("first send"), 2)).toBe(false);
});

it("allows a keyboard or assistive Stop (detail 0) inside the grace window", () => {
  mount();
  clickAllowed(button("first send"), 1);
  toStop(button("first send"));
  expect(clickAllowed(button("first send"), 0)).toBe(true);
});

it("does not record a keyboard Send, so a following pointer Stop is allowed", () => {
  mount();
  clickAllowed(button("first send"), 0);
  toStop(button("first send"));
  expect(clickAllowed(button("first send"), 1)).toBe(true);
});

it("allows a Stop in a different composer from the one that sent", () => {
  mount();
  clickAllowed(button("first send"), 1);
  toStop(button("second send"));
  expect(clickAllowed(button("second send"), 1)).toBe(true);
});

it("allows a Stop when nothing was sent yet", () => {
  mount();
  toStop(button("first send"));
  expect(clickAllowed(button("first send"), 2)).toBe(true);
});

it.each(["first disabled send", "first other", "loose send"])("ignores a click on %s and records no Send", name => {
  mount();
  expect(clickAllowed(button(name), 1)).toBe(true);
  toStop(button("first send"));
  expect(clickAllowed(button("first send"), 1)).toBe(true);
});

it("finds no composer button for a target that is not an element", () => {
  expect(enabledComposerButton(document.createTextNode("plain text"))).toBeNull();
});

it("returns the enabled button together with the composer that owns it", () => {
  mount();
  const send = button("first send");
  expect(enabledComposerButton(send)).toEqual({ button: send, composer: send.parentElement });
});
