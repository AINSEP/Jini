import { describe, expect, it } from "vitest";
import type { AdminMedia } from "@jini-ai/core/contracts/site/cms-admin-media";
import {
  documentExtensionSuffix,
  documentName,
  documentPreviewKind,
  documentTypeLabel,
  documentUploaderLabel,
  formatLibraryBytes,
  LIBRARY_ACCEPT,
  LIBRARY_MAX_BYTES,
  libraryExtension,
  libraryFileProblem,
  sortDocuments,
  validDocumentStem,
} from "../rules";

/**
 * @file Pure Library rules: picker acceptance, size formatting, row labels, preview routing and the
 * client mirror of the server's rename rule. Each case pins one observable outcome the Library
 * screen renders or acts on.
 */

describe("libraryExtension", () => {
  it("returns the lower-cased text after the last dot", () => {
    expect(libraryExtension({ filename: "Report.Final.PDF" })).toBe("pdf");
  });

  it("treats a leading-dot name and a dotless name as having no extension", () => {
    expect(libraryExtension({ filename: ".env" })).toBe("");
    expect(libraryExtension({ filename: "README" })).toBe("");
  });
});

describe("LIBRARY_ACCEPT", () => {
  it("lists every accepted extension as a dotted picker filter", () => {
    expect(LIBRARY_ACCEPT.split(",")).toContain(".md");
    expect(LIBRARY_ACCEPT.split(",")).toContain(".key");
    expect(LIBRARY_ACCEPT.startsWith(".md,")).toBe(true);
  });
});

describe("libraryFileProblem", () => {
  it("refuses an extension the server does not accept", () => {
    expect(libraryFileProblem({ name: "photo.png", size: 10 })).toBe("type");
  });

  it("reports a zero-byte iWork file as a package (a folder bundle the browser cannot read)", () => {
    expect(libraryFileProblem({ name: "deck.key", size: 0 })).toBe("package");
    expect(libraryFileProblem({ name: "doc.pages", size: 0 })).toBe("package");
  });

  it("reports any other zero-byte file as empty", () => {
    expect(libraryFileProblem({ name: "notes.md", size: 0 })).toBe("empty");
  });

  it("refuses a file one byte over the 10 MiB cap but accepts one exactly at it", () => {
    expect(libraryFileProblem({ name: "big.pdf", size: LIBRARY_MAX_BYTES + 1 })).toBe("size");
    expect(libraryFileProblem({ name: "big.pdf", size: LIBRARY_MAX_BYTES })).toBeNull();
  });
});

describe("formatLibraryBytes", () => {
  it("renders a dash for missing, non-finite and negative sizes", () => {
    expect(formatLibraryBytes({ bytes: null })).toBe("—");
    expect(formatLibraryBytes({ bytes: undefined })).toBe("—");
    expect(formatLibraryBytes({ bytes: Number.NaN })).toBe("—");
    expect(formatLibraryBytes({ bytes: Number.POSITIVE_INFINITY })).toBe("—");
    expect(formatLibraryBytes({ bytes: -1 })).toBe("—");
  });

  it("renders bytes below 1 KiB as whole bytes", () => {
    expect(formatLibraryBytes({ bytes: 0 })).toBe("0 B");
    expect(formatLibraryBytes({ bytes: 1023 })).toBe("1023 B");
  });

  it("uses one decimal below 10 units and whole numbers at or above", () => {
    expect(formatLibraryBytes({ bytes: 1536 })).toBe("1.5 KB");
    expect(formatLibraryBytes({ bytes: 20 * 1024 })).toBe("20 KB");
    expect(formatLibraryBytes({ bytes: 1.2 * 1024 * 1024 })).toBe("1.2 MB");
  });

  it("stops at GB rather than inventing a larger unit", () => {
    expect(formatLibraryBytes({ bytes: 3 * 1024 ** 3 })).toBe("3.0 GB");
    expect(formatLibraryBytes({ bytes: 2048 * 1024 ** 3 })).toBe("2048 GB");
  });
});

describe("documentName", () => {
  it("prefers the server's display filename", () => {
    expect(documentName({ title: "Ignored", displayFilename: "Shown.md", originalFilename: "orig.md" })).toBe("Shown.md");
  });

  it("falls back to title plus the original extension", () => {
    expect(documentName({ title: "Plan", displayFilename: null, originalFilename: "upload.PDF" } as never)).toBe("Plan.pdf");
  });

  it("uses the bare title when the original filename has no extension or is absent", () => {
    expect(documentName({ title: "Plan", displayFilename: null, originalFilename: "README" } as never)).toBe("Plan");
    expect(documentName({ title: "Plan", displayFilename: null, originalFilename: null } as never)).toBe("Plan");
  });
});

describe("documentTypeLabel and documentExtensionSuffix", () => {
  it("derive from the original filename first", () => {
    const item = { originalFilename: "a.csv", displayFilename: "b.md" };
    expect(documentTypeLabel(item)).toBe("CSV");
    expect(documentExtensionSuffix(item)).toBe(".csv");
  });

  it("fall back to the display filename when the original is missing", () => {
    const item = { originalFilename: null, displayFilename: "b.md" } as never;
    expect(documentTypeLabel(item)).toBe("MD");
    expect(documentExtensionSuffix(item)).toBe(".md");
  });

  it("render a dash and an empty suffix when neither name carries an extension", () => {
    const item = { originalFilename: null, displayFilename: null } as never;
    expect(documentTypeLabel(item)).toBe("—");
    expect(documentExtensionSuffix(item)).toBe("");
  });
});

describe("documentPreviewKind", () => {
  it.each([
    ["a.md", "markdown"],
    ["a.txt", "text"],
    ["a.csv", "text"],
    ["a.json", "text"],
    ["a.pdf", "pdf"],
    ["a.docx", "download"],
  ])("routes %s to the %s preview", (originalFilename, kind) => {
    expect(documentPreviewKind({ originalFilename, displayFilename: null } as never)).toBe(kind);
  });

  it("uses the display filename when no original filename is recorded, and downloads when neither exists", () => {
    expect(documentPreviewKind({ originalFilename: null, displayFilename: "x.md" } as never)).toBe("markdown");
    expect(documentPreviewKind({ originalFilename: null, displayFilename: null } as never)).toBe("download");
  });
});

describe("validDocumentStem", () => {
  it("returns the trimmed stem when the server would accept it", () => {
    expect(validDocumentStem({ draft: "  Quarterly plan  " })).toBe("Quarterly plan");
    expect(validDocumentStem({ draft: "x".repeat(240) })).toBe("x".repeat(240));
  });

  it("refuses blank, over-long, slashed and control-character stems", () => {
    expect(validDocumentStem({ draft: "   " })).toBeNull();
    expect(validDocumentStem({ draft: "x".repeat(241) })).toBeNull();
    expect(validDocumentStem({ draft: "a/b" })).toBeNull();
    expect(validDocumentStem({ draft: "a\\b" })).toBeNull();
    expect(validDocumentStem({ draft: `a${String.fromCharCode(7)}b` })).toBeNull();
    expect(validDocumentStem({ draft: `a${String.fromCharCode(127)}b` })).toBeNull();
  });
});

describe("documentUploaderLabel", () => {
  it("shows the unknown label for a row without an uploader", () => {
    expect(documentUploaderLabel({ item: { createdBy: null } as never, unknownLabel: "Unknown" })).toBe("Unknown");
  });

  it("maps a principal id to its username, falling back to the raw id", () => {
    const userNames = new Map([["u1", "ada"]]);
    expect(documentUploaderLabel({ item: { createdBy: "u1" }, unknownLabel: "Unknown" }, { userNames })).toBe("ada");
    expect(documentUploaderLabel({ item: { createdBy: "u2" }, unknownLabel: "Unknown" }, { userNames })).toBe("u2");
    expect(documentUploaderLabel({ item: { createdBy: "u3" }, unknownLabel: "Unknown" })).toBe("u3");
  });
});

describe("sortDocuments", () => {
  it("orders newest first without mutating the input", () => {
    const items = [
      { id: "old", createdAt: "2026-01-01T00:00:00Z" },
      { id: "new", createdAt: "2026-03-01T00:00:00Z" },
      { id: "mid", createdAt: "2026-02-01T00:00:00Z" },
    ] as AdminMedia[];
    expect(sortDocuments({ items }).map((item) => item.id)).toEqual(["new", "mid", "old"]);
    expect(items.map((item) => item.id)).toEqual(["old", "new", "mid"]);
  });
});
