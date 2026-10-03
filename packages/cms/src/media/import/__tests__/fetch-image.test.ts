import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "vitest";
import sharp from "sharp";

import type { HttpClientPort, HttpRequest, HttpResponse } from "@jini-ai/core/primitives";
import {
  buildImportFilename as buildImportFilenameCore,
  fetchImage as fetchImageCore,

  MediaImportValidationError,
  parseImportUrl as parseImportUrlCore,
  validateImageBytes as validateImageBytesCore,
} from "../fetch-image.js";

const REAL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAACc0lEQVR4nAXBvUodMBQA4PMIeYKSFxCy1yGruGSq4BQQB6cecBFEiEsFFyOCDlXMoDgINYogDtoDd1ARa1BE4YrmcrUXvYhHr/8/Tb8PAIqAIqEoKBqKgWKhIBQHxUMJUCIUgpKgZCgMBUAUIf5J8anEhxbvRrxZ8YrixYlnL56CeIzigUQrifss7lgwgCxCfkr5ruSrls9GPlrZQnnn5K2XN0E2o7wi2UjyMss6yxqAKkJ9SPWq1JNWLaPYqhtU1041vLoIqhbVGalqUidZHbE6ANBF6Hepn5VuaX1rdNPqBuq60+deV4M+jvqQ9H7Su1lvsa4AmCLMmzSPyrA2TWP+WlNDc+rMsTcHwexFs02mksxmNutsVgFsEfZV2payN9o2jK1ZW0V75Oy+tzvBVqLdILuW7HK2i2znAbAIfJF4p/BaY93gqcUjxD8OtzxSwPWIK4SLCecyzjBOArgi3LN0t8o1tDs37ti6fXRbzv32bi24pegWyM0mN5XdGLsRAF+Ef5L+RvkL7avGH1i/g56cX/P+V/Dz0U+Tn0h+NPth9gMAoYjwKENThZoOxybs2VDBsO7Ckg/zIfyMYZzCSApDOfRz6AOIRcQHGa9UPNPx0MRtGzcwrri44ON0iOMx/qA4mCLm2MuxG4CKoJakhqKqpn1DFUtrSIuOZj1NBBqJNEj0PVFPpi6mToBURLqX6VKlE512Tdq0aRnTnEtTPo2GNBQTUupJ6VtOHZzaAXIR+U7muspHOm+ZvG7zIuYZl8d8Hg65P+Zeyl0pd+T8lXMbABfBLLmm+EBzxfCq5XnkSccjngcC90XuJu5M3J65jfnLf/72ttBVSbpjAAAAAElFTkSuQmCC",
  "base64"
);

const MP4_HEADER = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x20]),
  Buffer.from("ftypisom", "ascii"),
  Buffer.from([0x00, 0x00, 0x02, 0x00]),
  Buffer.from("isomiso2avc1mp41", "ascii"),
]);

const WEBM_HEADER = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01]);

const HTML_BODY = Buffer.from("<!DOCTYPE html>\n<html><head><title>Sign in</title></head><body>nope</body></html>", "utf8");
const SVG_BODY = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', "utf8");

class FakeHttpClient implements HttpClientPort {
  readonly calls: HttpRequest[] = [];
  private readonly responses: (HttpResponse | Error)[];
  private cursor = 0;

  constructor(responses: (HttpResponse | Error)[]) {
    this.responses = responses;
  }

  async send({ request }: { request: HttpRequest }): Promise<HttpResponse> {
    this.calls.push(request);
    const next = this.responses[Math.min(this.cursor, this.responses.length - 1)];
    this.cursor += 1;
    if (next instanceof Error) throw next;
    return next!;
  }
}

function imageResponse(bytes: Uint8Array, overrides: Partial<HttpResponse> = {}): HttpResponse {
  return {
    status: 200,
    headers: { "content-type": "image/png" },
    bodyText: Buffer.from(bytes).toString("utf8"),
    bodyBytes: bytes,
    bodyTruncated: false,
    ...overrides,
  };
}

const URL_UNDER_TEST = "https://cdn.example.com/generated/fox.png";

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(Buffer.from(bytes)).digest("hex");
}

// ---------------------------------------------------------------------------
// 1. The happy path, asserted on the actual bytes
// ---------------------------------------------------------------------------

test("a real PNG round-trips byte-for-byte: the bytes fetchImage returns are the exact bytes the client returned, hash included", async () => {
  const client = new FakeHttpClient([imageResponse(REAL_PNG)]);

  const fetched = await fetchImage({ httpClient: client }, { url: URL_UNDER_TEST });

  assert.deepStrictEqual(Buffer.from(fetched.bytes), REAL_PNG, "the returned bytes must be identical to the response bytes, not a re-encoding of them");
  assert.equal(fetched.bytes.byteLength, REAL_PNG.byteLength);
  assert.equal(sha256(fetched.bytes), sha256(REAL_PNG), "sha256 must match — this is what dedup and the on-disk blob path are keyed by");
  assert.equal(fetched.contentType, "image/png");
  assert.equal(fetched.url.href, URL_UNDER_TEST);
});

test("the PNG fixture's bytes are NOT recoverable through a UTF-8 round trip — the contrast that justifies bodyBytes existing at all", () => {
  const throughText = Buffer.from(REAL_PNG.toString("utf8"), "utf8");
  assert.notDeepStrictEqual(
    throughText,
    REAL_PNG,
    "if this ever passes, the fixture stopped being a real binary payload and every byte-for-byte assertion in this file became vacuous"
  );
});

test("the outbound request is a bounded GET that asks for an image and nothing else", async () => {
  const client = new FakeHttpClient([imageResponse(REAL_PNG)]);

  await fetchImage({ httpClient: client }, { url: URL_UNDER_TEST });

  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0]!.method, "GET");
  assert.equal(client.calls[0]!.url, URL_UNDER_TEST);
  assert.equal(client.calls[0]!.timeoutMs, MEDIA_IMPORT_TIMEOUT_MS);
  assert.equal(client.calls[0]!.body, undefined, "an import must never send a request body");
  assert.deepEqual(client.calls[0]!.headers, { Accept: [...IMPORTABLE_CONTENT_TYPES].join(", ") });
});

// ---------------------------------------------------------------------------
// 2. Truncation — the case that could silently store a corrupt image
// ---------------------------------------------------------------------------

test("a truncated response is REFUSED even though its magic bytes are a perfectly valid PNG signature", async () => {
  const clipped = REAL_PNG.subarray(0, 200);
  assert.deepStrictEqual(
    Buffer.from(clipped.subarray(0, 8)),
    Buffer.from(REAL_PNG.subarray(0, 8)),
    "the clipped fixture must still carry the PNG signature, or this test proves nothing about truncation-before-sniffing"
  );
  const client = new FakeHttpClient([imageResponse(clipped, { bodyTruncated: true })]);

  await assert.rejects(
    () => fetchImage({ httpClient: client }, { url: URL_UNDER_TEST }),
    (error: unknown) => {
      assert.ok(error instanceof MediaImportValidationError, `expected MediaImportValidationError, got ${String(error)}`);
      assert.match(error.message, /Nothing was saved/);
      assert.match(error.message, /corrupt file, not a smaller one/);
      return true;
    }
  );
});

test("truncation is checked BEFORE sniffing — a whole, valid PNG flagged truncated is still rejected", () => {
  assert.throws(
    () => validateImageBytes(new URL(URL_UNDER_TEST), REAL_PNG, true),
    (error: unknown) => {
      assert.ok(error instanceof MediaImportValidationError);
      assert.match((error as Error).message, /import limit/);
      return true;
    }
  );
});

// ---------------------------------------------------------------------------
// 3. The header lies; the bytes decide
// ---------------------------------------------------------------------------

test("Content-Type: image/png over an HTML body is rejected — the served header is never consulted", async () => {
  const client = new FakeHttpClient([imageResponse(HTML_BODY, { headers: { "content-type": "image/png" } })]);

  await assert.rejects(
    () => fetchImage({ httpClient: client }, { url: URL_UNDER_TEST }),
    (error: unknown) => {
      assert.ok(error instanceof MediaImportValidationError);
      assert.match((error as Error).message, /its actual bytes are 'text\/html'/);
      assert.match((error as Error).message, /the served Content-Type header is deliberately ignored/);
      return true;
    }
  );
});

test("an MP4 served as image/png round-trips byte-for-byte — the header is still ignored, the bytes still decide, and video is now an importable shape", async () => {
  const client = new FakeHttpClient([imageResponse(MP4_HEADER, { headers: { "content-type": "image/png" } })]);

  const fetched = await fetchImage({ httpClient: client }, { url: URL_UNDER_TEST });

  assert.deepStrictEqual(Buffer.from(fetched.bytes), MP4_HEADER);
  assert.equal(fetched.contentType, "video/mp4");
});

test("a WebM served with no content-type header round-trips byte-for-byte and sniffs as video/webm", async () => {
  const client = new FakeHttpClient([imageResponse(WEBM_HEADER, { headers: {} })]);

  const fetched = await fetchImage({ httpClient: client }, { url: URL_UNDER_TEST });

  assert.deepStrictEqual(Buffer.from(fetched.bytes), WEBM_HEADER);
  assert.equal(fetched.contentType, "video/webm");
});

test("an SVG served as image/png is rejected — SVG has no ingest sanitizer, so it is not importable regardless of the header", async () => {
  const client = new FakeHttpClient([imageResponse(SVG_BODY, { headers: { "content-type": "image/png" } })]);

  await assert.rejects(() => fetchImage({ httpClient: client }, { url: URL_UNDER_TEST }), /its actual bytes are 'image\/svg\+xml'/);
});

test("a '.png.html' double-extension URL is decided by its bytes, not by either extension", async () => {
  const client = new FakeHttpClient([imageResponse(HTML_BODY)]);

  await assert.rejects(() => fetchImage({ httpClient: client }, { url: "https://cdn.example.com/a/photo.png.html" }), /its actual bytes are 'text\/html'/);
});

test("IMPORTABLE_CONTENT_TYPES is exactly the five still-image types plus video/mp4 and video/webm — the same set uploadMedia's own DEFAULT_ALLOWED_MIME_TYPES accepts, never silently widened beyond it (e.g. to SVG)", () => {
  assert.deepEqual(
    [...IMPORTABLE_CONTENT_TYPES].sort(),
    ["image/avif", "image/gif", "image/jpeg", "image/png", "image/webp", "video/mp4", "video/webm"]
  );
});

// ---------------------------------------------------------------------------
// 4. Size and emptiness
// ---------------------------------------------------------------------------

test("a body one byte over MEDIA_IMPORT_MAX_BYTES is rejected", async () => {
  const oversized = Buffer.alloc(MEDIA_IMPORT_MAX_BYTES + 1);
  REAL_PNG.copy(oversized, 0);
  const client = new FakeHttpClient([imageResponse(oversized)]);

  await assert.rejects(
    () => fetchImage({ httpClient: client }, { url: URL_UNDER_TEST }),
    (error: unknown) => {
      assert.ok(error instanceof MediaImportValidationError);
      assert.match((error as Error).message, new RegExp(`${MEDIA_IMPORT_MAX_BYTES}-byte import limit`));
      return true;
    }
  );
});

test("a body exactly AT the cap is accepted — the boundary is inclusive, so the check is not off by one in the rejecting direction", () => {
  const atCap = Buffer.alloc(MEDIA_IMPORT_MAX_BYTES);
  REAL_PNG.copy(atCap, 0);
  assert.equal(validateImageBytes(new URL(URL_UNDER_TEST), atCap, false), "image/png");
});

test("an empty body is rejected with its own message, not mistaken for an unknown format", async () => {
  const client = new FakeHttpClient([imageResponse(Buffer.alloc(0))]);

  await assert.rejects(
    () => fetchImage({ httpClient: client }, { url: URL_UNDER_TEST }),
    (error: unknown) => {
      assert.ok(error instanceof MediaImportValidationError);
      assert.match((error as Error).message, /returned an empty response body/);
      return true;
    }
  );
});

// ---------------------------------------------------------------------------
// 5. Scheme / credentials — rejected BEFORE the network, proven by the call log
// ---------------------------------------------------------------------------

for (const [label, badUrl] of [
  ["plain http", "http://cdn.example.com/fox.png"],
  ["file", "file:///etc/passwd"],
  ["data URI", "data:image/png;base64,iVBORw0KGgo="],
  ["gopher", "gopher://example.com/fox.png"],
] as const) {
  test(`a ${label} URL is rejected and the HTTP client is NEVER called`, async () => {
    const client = new FakeHttpClient([imageResponse(REAL_PNG)]);

    await assert.rejects(
      () => fetchImage({ httpClient: client }, { url: badUrl }),
      (error: unknown) => {
        assert.ok(error instanceof MediaImportValidationError, `expected MediaImportValidationError, got ${String(error)}`);
        assert.match((error as Error).message, /must use https/);
        return true;
      }
    );
    assert.equal(client.calls.length, 0, "the scheme check must run before the request — a call here would mean the server made the request anyway");
  });
}

for (const [label, badUrl] of [
  ["a relative path", "/images/fox.png"],
  ["a bare hostname", "cdn.example.com/fox.png"],
  ["an empty string", ""],
  ["a protocol-relative reference", "//cdn.example.com/fox.png"],
] as const) {
  test(`${label} is rejected as not-an-absolute-URL, and the HTTP client is NEVER called`, async () => {
    const client = new FakeHttpClient([imageResponse(REAL_PNG)]);

    await assert.rejects(
      () => fetchImage({ httpClient: client }, { url: badUrl }),
      (error: unknown) => {
        assert.ok(error instanceof MediaImportValidationError);
        assert.match((error as Error).message, /must be an absolute URL including the scheme/);
        return true;
      }
    );
    assert.equal(client.calls.length, 0);
  });
}

test("a URL embedding credentials is rejected before the network — no token is ever put on the wire", async () => {
  const client = new FakeHttpClient([imageResponse(REAL_PNG)]);

  await assert.rejects(
    () => fetchImage({ httpClient: client }, { url: "https://user:hunter2@cdn.example.com/fox.png" }),
    (error: unknown) => {
      assert.ok(error instanceof MediaImportValidationError);
      assert.match((error as Error).message, /must not embed credentials/);
      return true;
    }
  );
  assert.equal(client.calls.length, 0);
});

test("a password-only URL (no username) is rejected too", () => {
  assert.throws(() => parseImportUrl("https://:hunter2@cdn.example.com/fox.png"), /must not embed credentials/);
});

test("parseImportUrl accepts an ordinary https URL and returns it normalized", () => {
  assert.equal(parseImportUrl("https://CDN.Example.com/a/fox.png?sig=abc").href, "https://cdn.example.com/a/fox.png?sig=abc");
});

// ---------------------------------------------------------------------------
// 6. Non-2xx
// ---------------------------------------------------------------------------

for (const status of [403, 404] as const) {
  test(`HTTP ${status} is rejected WITH the expired-signed-URL hint, so the model asks for a fresh URL instead of retrying`, async () => {
    const client = new FakeHttpClient([{ status, headers: {}, bodyText: "", bodyBytes: new Uint8Array(0) }]);

    await assert.rejects(
      () => fetchImage({ httpClient: client }, { url: URL_UNDER_TEST }),
      (error: unknown) => {
        assert.ok(error instanceof MediaImportValidationError);
        assert.match((error as Error).message, new RegExp(`returned HTTP ${status}, not an image`));
        assert.match((error as Error).message, /expire quickly — ask for a fresh URL/);
        return true;
      }
    );
  });
}

test("HTTP 500 is rejected WITHOUT the expiry hint — a broken host is not an expired link", async () => {
  const client = new FakeHttpClient([{ status: 500, headers: {}, bodyText: "boom", bodyBytes: Buffer.from("boom") }]);

  await assert.rejects(
    () => fetchImage({ httpClient: client }, { url: URL_UNDER_TEST }),
    (error: unknown) => {
      assert.ok(error instanceof MediaImportValidationError);
      assert.match((error as Error).message, /returned HTTP 500, not an image\.$/);
      return true;
    }
  );
});

test("a 3xx that reached this layer (redirects exhausted inside the client) is rejected, not treated as a body", async () => {
  const client = new FakeHttpClient([{ status: 302, headers: { location: "https://elsewhere.example.com/fox.png" }, bodyText: "", bodyBytes: new Uint8Array(0) }]);

  await assert.rejects(() => fetchImage({ httpClient: client }, { url: URL_UNDER_TEST }), /returned HTTP 302, not an image/);
});

test("a transport-level failure (an EgressPolicy/SSRF refusal) propagates as itself and is NOT relabelled a shape problem", async () => {
  const refusal = new Error("egress to 'metadata.internal' (169.254.169.254) rejected: resolved address is link-local");
  const client = new FakeHttpClient([refusal]);

  const error = await fetchImage({ httpClient: client }, { url: "https://metadata.internal/latest/meta-data/" }).then(
    () => null,
    (e: unknown) => e as Error
  );

  assert.ok(error);
  assert.equal(error, refusal, "the client's own refusal must reach the caller unwrapped");
  assert.ok(!(error instanceof MediaImportValidationError), "an SSRF refusal is not a 'try a different shape' error and must not be reported as one");
});

// ---------------------------------------------------------------------------
// 7. bodyBytes absent — a legacy double must fail loudly, never fall back to bodyText
// ---------------------------------------------------------------------------

test("a client that returns no bodyBytes is REFUSED — the bytes are never reconstructed from the lossy bodyText", async () => {
  const legacy: HttpResponse = { status: 200, headers: { "content-type": "image/png" }, bodyText: REAL_PNG.toString("utf8") };
  const client = new FakeHttpClient([legacy]);

  await assert.rejects(
    () => fetchImage({ httpClient: client }, { url: URL_UNDER_TEST }),
    (error: unknown) => {
      assert.ok(error instanceof MediaImportValidationError);
      assert.match((error as Error).message, /returned no raw bytes/);
      assert.match((error as Error).message, /refusing to reconstruct image data from its lossy text decoding/);
      return true;
    }
  );
});

test("an absent bodyTruncated is simply no signal — it does not trigger the truncation rejection, and it is not read as a positive 'complete'", async () => {
  const noFlag: HttpResponse = { status: 200, headers: {}, bodyText: "", bodyBytes: REAL_PNG };
  const fetched = await fetchImage({ httpClient: new FakeHttpClient([noFlag]) }, { url: URL_UNDER_TEST });
  assert.deepStrictEqual(Buffer.from(fetched.bytes), REAL_PNG);
});

// ---------------------------------------------------------------------------
// 8. Filenames
// ---------------------------------------------------------------------------

test("the extension comes from the SNIFFED type, never from the URL", () => {
  assert.equal(buildImportFilename(new URL("https://cdn.example.com/a/fox.png"), "image/jpeg"), "fox.jpg");
  assert.equal(buildImportFilename(new URL("https://cdn.example.com/a/fox.exe"), "image/png"), "fox.png");
  assert.equal(buildImportFilename(new URL("https://cdn.example.com/a/fox.png"), "image/webp"), "fox.webp");
  assert.equal(buildImportFilename(new URL("https://cdn.example.com/a/fox"), "image/avif"), "fox.avif");
  assert.equal(buildImportFilename(new URL("https://cdn.example.com/a/fox.png"), "image/gif"), "fox.gif");
  assert.equal(buildImportFilename(new URL("https://cdn.example.com/a/fox.mov"), "video/mp4"), "fox.mp4");
  assert.equal(buildImportFilename(new URL("https://cdn.example.com/a/fox"), "video/webm"), "fox.webm");
});

test("a path-traversal segment cannot survive into the filename", () => {
  const built = buildImportFilename(new URL("https://cdn.example.com/x/%2e%2e%2f%2e%2e%2fetc%2fpasswd"), "image/png");
  assert.ok(!built.includes("/"), `no separators may survive: got '${built}'`);
  assert.ok(!built.includes(".."), `no dot-dot may survive: got '${built}'`);
  assert.ok(built.endsWith(".png"));
});

test("an explicit '../../etc/passwd' override cannot escape either", () => {
  const built = buildImportFilename(new URL("https://cdn.example.com/a/fox.png"), "image/png", "../../etc/passwd");
  assert.ok(!built.includes("/"));
  assert.ok(!built.includes(".."));
  assert.ok(built.endsWith(".png"));
});

test("control characters are stripped rather than carried into the stored name", () => {
  const built = buildImportFilename(new URL("https://cdn.example.com/a/fox.png"), "image/png", "ev\u0000il\nna\tme");
  assert.ok(
    [...built].every((character) => character.codePointAt(0)! >= 0x20 && character.codePointAt(0) !== 0x7f),
    `control characters must not survive: got ${JSON.stringify(built)}`
  );
  assert.equal(built, "ev-il-na-me.png");
});

test("a 400-character name is length-bounded", () => {
  const built = buildImportFilename(new URL("https://cdn.example.com/a/fox.png"), "image/png", "a".repeat(400));
  assert.ok(built.length <= 64, `expected a bounded name, got ${built.length} characters`);
  assert.equal(built, `${"a".repeat(60)}.png`);
});

test("the filename override wins for the STEM but never for the extension", () => {
  assert.equal(buildImportFilename(new URL("https://cdn.example.com/a/8f3ac91b0e.png"), "image/png", "red fox in snow.jpeg"), "red-fox-in-snow.png");
});

test("a URL with no usable last segment still produces a real name", () => {
  assert.equal(buildImportFilename(new URL("https://cdn.example.com/"), "image/png"), "imported-image.png");
  assert.equal(buildImportFilename(new URL("https://cdn.example.com/a/---"), "image/png"), "imported-image.png");
});

test("a percent-encoded human name decodes before sanitizing", () => {
  assert.equal(buildImportFilename(new URL("https://cdn.example.com/a/red%20fox%20dawn.png"), "image/png"), "red-fox-dawn.png");
});

// ---------------------------------------------------------------------------
// 9. MI-01 — a complete image must not be rejected because its TEXT half was clipped
//
// `fetchImage` reads `bodyBytes` and never `bodyText`, so text truncation says nothing about
// whether the image it is about to store is whole. The response shapes below are exactly what
// `platform/http`'s `capResponse` now emits (pinned on that side by
// `platform/http/__tests__/body-bytes.test.ts`) — this file's job is that this consumer reads the
// byte half's flag and only the byte half's flag.
// ---------------------------------------------------------------------------

test("an image whose BYTES are complete is imported even though the response's lossy text half was clipped — the false 'exceeds the import limit' rejection", async () => {
  // A 7-10 MiB PNG against MEDIA_IMPORT_EGRESS_POLICY's 12 MiB cap, in miniature: compressed image
  // data decodes ~1.8x larger through UTF-8, so the text half trips a cap the bytes never reach.
  const client = new FakeHttpClient([imageResponse(REAL_PNG, { bodyTruncated: true, bodyBytesTruncated: false })]);

  const fetched = await fetchImage({ httpClient: client }, { url: URL_UNDER_TEST });

  assert.deepStrictEqual(Buffer.from(fetched.bytes), REAL_PNG, "the whole image was there and must be imported whole");
  assert.equal(sha256(fetched.bytes), sha256(REAL_PNG), "and byte-identical — not a text round trip that happened to succeed");
  assert.equal(fetched.contentType, "image/png");
});

test("bodyBytesTruncated:true is still refused with the exact import-limit message, even when the text half reports itself whole", async () => {
  const clipped = REAL_PNG.subarray(0, 200);
  const client = new FakeHttpClient([imageResponse(clipped, { bodyTruncated: false, bodyBytesTruncated: true })]);

  await assert.rejects(
    () => fetchImage({ httpClient: client }, { url: URL_UNDER_TEST }),
    (error: unknown) => {
      assert.ok(error instanceof MediaImportValidationError, `expected MediaImportValidationError, got ${String(error)}`);
      assert.equal(
        (error as Error).message,
        `the image at '${URL_UNDER_TEST}' exceeds the ${MEDIA_IMPORT_MAX_BYTES}-byte import limit. Nothing was saved — a partially downloaded image would be a corrupt file, not a smaller one.`
      );
      return true;
    }
  );
  assert.equal(client.calls.length, 1, "the rejection is about the response, so the request itself still happened exactly once");
});

test("validateImageBytes' third argument is the BYTE half's verdict — a whole PNG flagged there is still rejected", () => {
  assert.throws(
    () => validateImageBytes(new URL(URL_UNDER_TEST), REAL_PNG, true),
    (error: unknown) => {
      assert.ok(error instanceof MediaImportValidationError);
      assert.match((error as Error).message, /corrupt file, not a smaller one/);
      return true;
    }
  );
  assert.equal(validateImageBytes(new URL(URL_UNDER_TEST), REAL_PNG, false), "image/png", "and a whole PNG NOT flagged there sniffs normally");
});

// ---------------------------------------------------------------------------
// 10. MI-02 — the URL recorded is where the bytes came from, not where they were asked for
// ---------------------------------------------------------------------------

test("after a redirect the recorded URL is the hop that served the bytes, not the URL the assistant supplied", async () => {
  const finalUrl = "https://files.example.net/signed/abc123.png";
  const client = new FakeHttpClient([imageResponse(REAL_PNG, { finalUrl })]);

  const fetched = await fetchImage({ httpClient: client }, { url: URL_UNDER_TEST });

  assert.equal(fetched.url.href, finalUrl, "provenance is the point of this field");
  assert.equal(client.calls[0]!.url, URL_UNDER_TEST, "the request still goes to what was asked for — only the RECORD changes");
  assert.equal(buildImportFilename(fetched.url, fetched.contentType), "abc123.png", "and the default filename follows the bytes, not the request");
});

test("an absent finalUrl falls back to the requested URL — a client that does not report the final hop must not blank the provenance", async () => {
  const noFinalUrl: HttpResponse = { status: 200, headers: {}, bodyText: "", bodyBytes: REAL_PNG };

  const fetched = await fetchImage({ httpClient: new FakeHttpClient([noFinalUrl]) }, { url: URL_UNDER_TEST });

  assert.equal(fetched.url.href, URL_UNDER_TEST);
});

test("a finalUrl that does not parse is ignored rather than crashing an otherwise-good import", async () => {
  const client = new FakeHttpClient([imageResponse(REAL_PNG, { finalUrl: "not a url at all" })]);

  const fetched = await fetchImage({ httpClient: client }, { url: URL_UNDER_TEST });

  assert.equal(fetched.url.href, URL_UNDER_TEST, "falling back beats throwing: the bytes are fine, only the label was unusable");
  assert.deepStrictEqual(Buffer.from(fetched.bytes), REAL_PNG);
});

for (const [format, contentType] of [["jpeg", "image/jpeg"], ["gif", "image/gif"], ["webp", "image/webp"], ["avif", "image/avif"]] as const) {
  test(`fetchImage accepts real ${contentType} bytes independently of the served type`, async () => {
    const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: "red" } }).toFormat(format).toBuffer();
    const client = new FakeHttpClient([imageResponse(bytes)]);
    const result = await fetchImage({ httpClient: client }, { url: URL_UNDER_TEST });
    assert.equal(client.calls.length, 1);
    assert.equal(result.contentType, contentType);
    assert.deepEqual(Buffer.from(result.bytes), bytes);
  });
}

test("parseable HTTP finalUrl is kept as provenance for already-fetched bytes", async () => {
  const finalUrl = "http://cdn.example.net/actual-hop.png";
  const client = new FakeHttpClient([imageResponse(REAL_PNG, { finalUrl })]);
  const result = await fetchImage({ httpClient: client }, { url: URL_UNDER_TEST });
  assert.equal(result.url.href, finalUrl);
  assert.deepEqual(Buffer.from(result.bytes), REAL_PNG);
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0]!.url, URL_UNDER_TEST);
});

import { sniffContentType } from "../../content-type-sniffer.js";
const IMPORTABLE_CONTENT_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "video/mp4", "video/webm"]);
const MEDIA_IMPORT_MAX_BYTES = 10 * 1024 * 1024;
const MEDIA_IMPORT_TIMEOUT_MS = 20_000;
const policy = { allowedContentTypes: IMPORTABLE_CONTENT_TYPES, maxBytes: MEDIA_IMPORT_MAX_BYTES, sniffer: { sniff: ({ bytes }: { bytes: Uint8Array }) => sniffContentType({ bytes: bytes }) } };
function parseImportUrl(raw: string) { return parseImportUrlCore({ raw }); }
function buildImportFilename(url: URL, contentType: string, override?: string) { return buildImportFilenameCore({ url, contentType }, override === undefined ? {} : { override }); }
function validateImageBytes(source: URL | string, bytes: Uint8Array, bytesTruncated: boolean) { return validateImageBytesCore({ ...policy, source, bytes, bytesTruncated }); }
function fetchImage(deps: { httpClient: HttpClientPort }, input: { url: string }) {
  return fetchImageCore({ ...policy, ...deps, ...input, outboundGuard: { send: ({ request, httpClient }) => httpClient.send({ request }) } });
}
