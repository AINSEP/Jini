import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type express from "express";
/** Random-port HTTP fixture with registered teardown; no shared app or module mock. */
export async function startTestServer(
  app: express.Express,
  t: import("node:test").TestContext
): Promise<string> {
  const server = createServer(app);
  server.listen(0);
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

