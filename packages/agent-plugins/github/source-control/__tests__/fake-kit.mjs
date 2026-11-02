// Shared fakes for the github source-control tests: a scripted `kit.httpClient` that answers each
// request from a queue (an `Error` in the queue is thrown, as a transport failure is) and records
// every request it saw, so a test can assert both the outcome and the exact calls made.

/** @param {number} status @param {unknown} body @param {Record<string, string>} [headers] */
export function res(status, body, headers) {
  return { status, bodyText: typeof body === "string" ? body : JSON.stringify(body), ...(headers ? { headers } : {}) };
}

/** @param {unknown[]} script @param {{ sleep?: (ms: number) => Promise<void> }} [options] */
export function scriptedKit(script, options = {}) {
  const requests = [];
  const queue = [...script];
  const kit = {
    httpClient: {
      async send(request) {
        requests.push(request);
        if (queue.length === 0) return res(599, { message: `unscripted ${request.method} ${request.url}` });
        const next = queue.shift();
        if (next instanceof Error) throw next;
        return next;
      },
    },
    describeTransportError: (error) => ({ refusal: error.refusal, logDetail: `detail: ${error.message}` }),
    ...(options.sleep ? { sleep: options.sleep } : {}),
  };
  return { kit, requests, queue };
}

export const TARGET = { baseUrl: "https://api.github.com/", authorization: "Bearer tok", owner: "acme", repo: "site" };
export const REPO = "https://api.github.com/repos/acme/site";
