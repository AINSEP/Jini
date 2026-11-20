import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { ThemePreviewReloadControl } from '../../index.js';

it("reload button has translated label and tooltip and signals a new refresh", () => {
  let calls = 0;
  render(
    <ThemePreviewReloadControl
      className="probe"
      label="Reload preview"
      reload={() => {
        calls++;
      }}
    />,
  );
  const button = screen.getByRole("button", { name: "Reload preview" });
  expect(button.getAttribute("class")).toBe("probe");
  expect(button.getAttribute("title")).toBe("Reload preview");
  expect(button.querySelector("svg")?.getAttribute("stroke-width")).toBe("1.5");
  fireEvent.click(button);
  expect(calls).toBe(1);
});

it("disabled reload button does not signal a refresh", () => {
  let calls = 0;
  render(
    <ThemePreviewReloadControl
      className="probe"
      label="Reload preview"
      reload={() => {
        calls++;
      }}
      disabled
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Reload preview" }));
  expect(calls).toBe(0);
});
