import { describe, expect, it } from "vitest";

import { createHttpFormsApi, type FormsTransportPort } from "../adapters/http.js";
import { formAnswerColumns, formAnswerFile, formatFormAnswer, formSubmissionRows } from "../html-rules.js";
import type { AdminFormSubmission } from "../models.js";

/**
 * @file Submission answers as display text, and the file-answer download URL (2026-10-11).
 * Multi-choice answers are stored as arrays and file answers as `{ mediaId, filename, ... }`; the
 * submissions table and detail view showed them through `String()` as `a,b` and `[object Object]`.
 */

const file = { mediaId: "m 1", filename: "moodboard.png", contentType: "image/png", byteSize: 157 };
const options = [
  { value: "current-event", label: "Current event" },
  { value: "corporate", label: "Corporate events" },
];

function submission(data: Record<string, unknown>): AdminFormSubmission {
  return { id: "s1", formDefinitionId: "f1", data: data as AdminFormSubmission["data"], sourceIp: "127.0.0.1", submittedAt: "2026-10-11T00:00:00.000Z" } as unknown as AdminFormSubmission;
}

function fakeTransport(): FormsTransportPort {
  return {
    request: async () => { throw new Error("no request expected"); },
    url: ({ path }) => `https://host/api${path}`,
  };
}

describe("formatFormAnswer", () => {
  it("resolves stored choice values to their option labels", () => {
    expect(formatFormAnswer({ value: "current-event", options })).toBe("Current event");
    expect(formatFormAnswer({ value: "corporate", options })).toBe("Corporate events");
  });

  it("joins multi-choice labels in submitted order with a comma and space", () => {
    expect(formatFormAnswer({ value: ["corporate", "current-event"], options })).toBe("Corporate events, Current event");
  });

  it("keeps unknown values alongside known labels when options have been removed", () => {
    expect(formatFormAnswer({ value: "removed-option", options })).toBe("removed-option");
    expect(formatFormAnswer({ value: ["current-event", "removed-option", "corporate"], options })).toBe("Current event, removed-option, Corporate events");
    expect(formatFormAnswer({ value: "current-event", options: [] })).toBe("current-event");
  });

  it("joins multi-choice arrays with a comma and space", () => {
    expect(formatFormAnswer({ value: ["day-of", "vendors"] })).toBe("day-of, vendors");
  });

  it("shows a file answer as its filename and size", () => {
    expect(formatFormAnswer({ value: file })).toBe("moodboard.png (157 B)");
    expect(formatFormAnswer({ value: { ...file, byteSize: 2048 } })).toBe("moodboard.png (2 KB)");
    expect(formatFormAnswer({ value: { ...file, byteSize: 3 * 1024 * 1024 } })).toBe("moodboard.png (3 MB)");
    expect(formatFormAnswer({ value: { mediaId: "m", filename: "a.pdf" } })).toBe("a.pdf");
  });

  it("keeps scalars as before and never prints [object Object]", () => {
    expect(formatFormAnswer({ value: true })).toBe("Yes");
    expect(formatFormAnswer({ value: false })).toBe("No");
    expect(formatFormAnswer({ value: 120 })).toBe("120");
    expect(formatFormAnswer({ value: "Jordan" })).toBe("Jordan");
    expect(formatFormAnswer({ value: undefined })).toBe("");
    expect(formatFormAnswer({ value: null })).toBe("");
    expect(formatFormAnswer({ value: { other: 1 } })).toBe('{"other":1}');
  });
});

describe("formatFormAnswer booleans and dates", () => {
  const en = { locale: "en-US" };

  it("shows booleans with the host's translated labels", () => {
    expect(formatFormAnswer({ value: true, type: "toggle" }, { yes: "Oui", no: "Non" })).toBe("Oui");
    expect(formatFormAnswer({ value: false, type: "checkbox" }, { yes: "Oui", no: "Non" })).toBe("Non");
  });

  it("shows date, time and datetime answers as entered, in the locale's short form", () => {
    expect(formatFormAnswer({ value: "2026-11-02", type: "date" }, en)).toBe("Nov 2, 2026");
    expect(formatFormAnswer({ value: "10:15", type: "time" }, en)).toBe("10:15 AM");
    expect(formatFormAnswer({ value: "2026-11-02T10:15", type: "datetime" }, en)).toBe("Nov 2, 2026, 10:15 AM");
    expect(formatFormAnswer({ value: "2026-11-02T23:45:30", type: "datetime" }, en)).toBe("Nov 2, 2026, 11:45 PM");
    expect(formatFormAnswer({ value: "2026-11-02", type: "date" }, { locale: "en-GB" })).toBe("2 Nov 2026");
  });

  it("keeps unparseable temporal answers and date-shaped text in other fields raw", () => {
    expect(formatFormAnswer({ value: "soon", type: "date" }, en)).toBe("soon");
    expect(formatFormAnswer({ value: "", type: "datetime" }, en)).toBe("");
    expect(formatFormAnswer({ value: "2026-11-02T10:15", type: "text" }, en)).toBe("2026-11-02T10:15");
    expect(formatFormAnswer({ value: "2026-11-02" }, en)).toBe("2026-11-02");
  });

  it("formats table cells and detail rows by field type without changing stored answers", () => {
    const columns = formAnswerColumns({ fields: [
      { id: "consent", label: "Consent", type: "toggle", required: false },
      { id: "when", label: "When", type: "datetime", required: false },
    ] as never }, { ...en, yes: "Sí", no: "No" });
    const row = submission({ consent: true, when: "2026-11-02T10:15" });
    expect(columns.map(column => column.cell(row))).toEqual(["Sí", "Nov 2, 2026, 10:15 AM"]);
    expect(formSubmissionRows({ data: row.data, answerColumns: columns }).map(r => r.value)).toEqual(["Sí", "Nov 2, 2026, 10:15 AM"]);
    expect(row.data).toEqual({ consent: true, when: "2026-11-02T10:15" });
  });
});

describe("formAnswerFile", () => {
  it("narrows only objects carrying a string mediaId and filename", () => {
    expect(formAnswerFile({ value: file })).toEqual({ mediaId: "m 1", filename: "moodboard.png", byteSize: 157 });
    expect(formAnswerFile({ value: { mediaId: "m" } })).toBeNull();
    expect(formAnswerFile({ value: ["m"] })).toBeNull();
    expect(formAnswerFile({ value: "m" })).toBeNull();
    expect(formAnswerFile({ value: null })).toBeNull();
  });
});

describe("submission table and detail rows", () => {
  it.each([
    { type: "select", value: "current-event", expected: "Current event" },
    { type: "radio", value: "corporate", expected: "Corporate events" },
    { type: "checkbox-group", value: ["corporate", "removed-option", "current-event"], expected: "Corporate events, removed-option, Current event" },
    { type: "multi-select", value: ["current-event", "corporate"], expected: "Current event, Corporate events" },
  ])("uses the $type field's options in table cells without changing stored answers", ({ type, value, expected }) => {
    const answerColumns = formAnswerColumns({ fields: [{ id: "services", label: "Services", type, required: false, options }] });
    const row = submission({ services: Array.isArray(value) ? [...value] : value });
    expect(answerColumns[0]!.cell(row)).toBe(expected);
    expect(row.data.services).toEqual(value);
  });

  const columns = formAnswerColumns({ fields: [
    { id: "services", label: "Services", type: "multi-select", required: false },
    { id: "inspiration", label: "Inspiration", type: "file", required: false },
  ] as never });

  it("formats table cells through formatFormAnswer", () => {
    const row = submission({ services: ["a", "b"], inspiration: file });
    expect(columns.map(column => column.cell(row))).toEqual(["a, b", "moodboard.png (157 B)"]);
  });

  it("gives detail rows the file reference for the download link", () => {
    const rows = formSubmissionRows({ data: { services: ["a"], inspiration: file } as never, answerColumns: columns });
    expect(rows).toEqual([
      { key: "services", label: "Services", value: "a", file: null },
      { key: "inspiration", label: "Inspiration", value: "moodboard.png (157 B)", file: { mediaId: "m 1", filename: "moodboard.png", byteSize: 157 } },
    ]);
  });
});

describe("createHttpFormsApi submissionFileUrl", () => {
  it("builds the media original URL under the host's media path", () => {
    const api = createHttpFormsApi({ transport: fakeTransport(), basePath: "/workspaces/w/forms" }, { mediaBasePath: "/workspaces/w/media/" });
    expect(api.submissionFileUrl?.({ mediaId: "m 1" })).toBe("https://host/api/workspaces/w/media/m%201/original");
  });

  it("is absent when the host wires no media path", () => {
    const api = createHttpFormsApi({ transport: fakeTransport(), basePath: "/workspaces/w/forms" });
    expect(api.submissionFileUrl).toBeUndefined();
  });
});
