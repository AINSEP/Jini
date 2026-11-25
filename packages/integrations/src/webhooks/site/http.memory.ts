import type { HttpClientPort } from "./delivery.js";
import type { HttpRequest, HttpResponse } from "@jini-ai/core/primitives";

/**
 * @file A recording, scriptable `HttpClientPort` test double for the delivery worker.
 *
 * Purpose:
 * `processDueDeliveries` (./delivery.ts) depends on `HttpClientPort` (imported from `./delivery.ts`,
 * ADR-038) to POST signed deliveries. This is NOT the real guarded transport — building that is
 * the host transport's job (out of scope here). This is a recording double: every `send()` call is
 * captured for assertions, and responses (or thrown transport errors) are scripted per-call so
 * tests can exercise success, non-2xx failure, and repeated-failure-to-exhaustion paths without
 * a network.
 *
 * How it relates to the project:
 * - Satisfies the same `HttpClientPort` interface `./delivery.ts` declares, so it drops in
 *   wherever the real client would.
 * - Used by `./__tests__/delivery.test.ts`.
 *
 * Architectural role:
 * Test infrastructure only. Never wired into production composition.
 */

export interface RecordedHttpCall {
  readonly request: HttpRequest;
}

/** One scripted response: a literal response, or a thunk that can return or throw (to simulate
 * a transport-level failure rather than a non-2xx HTTP response). */
export type ScriptedHttpResponse = HttpResponse | (() => HttpResponse);

export interface RecordingHttpClientOptions {
  /**
   * Responses returned in call order. When calls exceed the list length, the last entry repeats
   * (so a short "always fails" script doesn't need one entry per retry attempt). Defaults to a
   * single always-200 response.
   */
  responses?: readonly ScriptedHttpResponse[];
}

/**
 * Records every `send()` call and returns scripted responses in order (see
 * `RecordingHttpClientOptions.responses`).
 *
 * @overallScore 100
 * Purity/effect: `send` is the one effectful method (records + returns/throws per script); no
 * other state mutation. No findings.
 */
export class RecordingHttpClient implements HttpClientPort {
  readonly calls: RecordedHttpCall[] = [];

  private readonly responses: readonly ScriptedHttpResponse[];
  private cursor = 0;

  constructor(options: RecordingHttpClientOptions = {}) {
    this.responses = options.responses ?? [{ status: 200, headers: {}, bodyText: "" }];
  }

  async send(request: HttpRequest): Promise<HttpResponse> {
    this.calls.push({ request });

    const index = Math.min(this.cursor, this.responses.length - 1);
    const entry = this.responses[index];
    this.cursor += 1;

    return typeof entry === "function" ? entry() : entry;
  }
}
