// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AdminKitProvider } from "../../../react/kit.js";
import { fakeAdminKit } from "../../../react/testing-kit.js";
import { UploadTab } from "../Library.js";
import type { LibraryController } from "../hooks/use-library.hooks.js";

/** Only the fields UploadTab reads; `t` is the identity so the asserted copy is the English key. */
function uploadController(): LibraryController {
  return {
    t: (key: string) => key,
    permissions: { known: true, canUpload: true },
    uploads: [],
    uploadedCount: 0,
    addFiles: () => undefined,
    clearUploads: () => undefined,
  } as unknown as LibraryController;
}

/** The shared fake dropzone drops `helper`, so this kit's dropzone renders it: the copy under test lives there. */
const kit = fakeAdminKit({ components: { FileDropzone: (p: { helper?: string }) => <p>{p.helper}</p> } as never });

describe("Library upload helper copy", () => {
  it("states the 50 MiB per-file limit the shared upload contract enforces, not the retired 10 MiB", () => {
    render(<AdminKitProvider kit={kit}><UploadTab controller={uploadController()} /></AdminKitProvider>);
    expect(screen.getByText("Documents: Markdown, text, PDF, Word, Excel, PowerPoint, Pages, Keynote, RTF, CSV, JSON · up to 50 MiB each")).toBeInTheDocument();
    expect(screen.queryByText(/up to 10 MiB each/)).toBeNull();
  });
});
