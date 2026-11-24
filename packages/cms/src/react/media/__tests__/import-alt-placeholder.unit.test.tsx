import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import type { ReactNode } from "react";
import { FetchQueryProvider } from "@jini-ai/ui/panel-kit";
import { useFetchMutation } from "@jini-ai/ui/fetch-query";
import { Button, Dialog, TextField } from "@jini-ai/ui-kit/react";
import { RemoteImageImport } from "../RemoteImageImport.js";

// The import alt field moved into its dialog with a visible label (owner item #9, 2026-10-13): the
// label reads as short as the upload dialog's, the accessible name stays distinct from that field's.
it("uses the upload dialog's short alt label while keeping a distinct accessible name", () => {
  render(<FetchQueryProvider><RemoteImageImport kit={{ Button, Dialog, TextField }} t={(key) => key} useFetchMutation={useFetchMutation} describeError={({ fallback }) => fallback}
    HeaderTip={({ children }: { label: string; children: ReactNode }) => <>{children}</>}
    port={{ listKey: ["media"], importFromUrl: async () => { throw new Error("Label inspection must not submit an import"); } }} /></FetchQueryProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Import from URL" }));
  const field = screen.getByRole("textbox", { name: "Imported image alt text (optional)" });
  expect(document.querySelector(`label[for="${field.id}"]`)).toHaveTextContent("Alt text (optional)");
});
