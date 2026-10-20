import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import net, { type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { PgliteSocketServer } from "../socket-server.js";

let db: PGlite;
let dir: string;
let server: PgliteSocketServer;
let socket: Socket;
beforeAll(async () => { db = await PGlite.create(); });
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "jw4-wire-"));
  server = new PgliteSocketServer({ db, path: join(dir, "socket") });
  await server.start();
  socket = net.createConnection(server.path);
  await once(socket, "connect");
});
afterEach(async () => {
  socket.destroy();
  await server.stop();
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

function startup({ code = 196608, body = Buffer.from("user\0postgres\0database\0postgres\0\0") }: { code?: number; body?: Buffer }, _optional = {}): Buffer {
  const message = Buffer.alloc(8 + body.length);
  message.writeInt32BE(message.length, 0);
  message.writeInt32BE(code, 4);
  body.copy(message, 8);
  return message;
}
function query({ text }: { text: string }, _optional = {}): Buffer {
  const body = Buffer.from(`${text}\0`);
  const message = Buffer.alloc(5 + body.length);
  message.write("Q", 0);
  message.writeInt32BE(4 + body.length, 1);
  body.copy(message, 5);
  return message;
}
function readyCount({ bytes }: { bytes: Buffer }, _optional = {}): number {
  let count = 0;
  let offset = 0;
  while (bytes.length - offset >= 5) {
    const size = 1 + bytes.readInt32BE(offset + 1);
    if (bytes.length - offset < size) break;
    if (bytes[offset] === 90) count += 1;
    offset += size;
  }
  return count;
}
async function exchange({ chunks, complete }: { chunks: readonly Buffer[]; complete: (bytes: Buffer) => boolean }, _optional = {}): Promise<Buffer> {
  let received = Buffer.alloc(0);
  const response = new Promise<Buffer>((resolve, reject) => {
    const onData = (chunk: Buffer) => {
      received = Buffer.concat([received, chunk]);
      if (complete(received)) { cleanup(); resolve(received); }
    };
    const onEnd = () => { cleanup(); reject(new Error("socket ended before the response was complete")); };
    const onError = (error: Error) => { cleanup(); reject(error); };
    const cleanup = () => {
      socket.off("data", onData);
      socket.off("end", onEnd);
      socket.off("error", onError);
    };
    socket.on("data", onData).once("end", onEnd).once("error", onError);
  });
  for (const chunk of chunks) {
    socket.write(chunk);
    await new Promise<void>(resolve => setImmediate(resolve));
  }
  return response;
}

test.each([80877103, 80877104])("SSL/GSS code %s is answered N and the following startup is still forwarded", async code => {
  const stream = vi.spyOn(db, "execProtocolRawStream");
  expect((await exchange({ chunks: [startup({ code, body: Buffer.alloc(0) })], complete: bytes => bytes.length === 1 })).toString()).toBe("N");
  const message = startup({});
  await exchange({ chunks: [message], complete: bytes => readyCount({ bytes }) === 1 });
  expect(stream.mock.calls.map(([bytes]) => Buffer.from(bytes))).toEqual([message]);
});

test("cancel requests close without forwarding to the PGlite backend", async () => {
  const stream = vi.spyOn(db, "execProtocolRawStream");
  const ended = once(socket, "end");
  socket.resume();
  socket.write(startup({ code: 80877102, body: Buffer.alloc(8) }));
  await ended;
  expect(stream.mock.calls).toEqual([]);
});

test("unsupported startup protocols close without forwarding to the backend", async () => {
  const stream = vi.spyOn(db, "execProtocolRawStream");
  const ended = once(socket, "end");
  socket.resume();
  socket.write(startup({ code: 1234, body: Buffer.alloc(0) }));
  await ended;
  expect(stream.mock.calls).toEqual([]);
});

test("an SSL request shorter than its header is still answered N (reported, not fixed)", async () => {
  const stream = vi.spyOn(db, "execProtocolRawStream");
  const malformed = startup({ code: 80877103, body: Buffer.alloc(0) });
  malformed.writeInt32BE(4, 0);
  const answer = await exchange({ chunks: [malformed], complete: bytes => bytes.length === 1 });
  expect(answer.toString()).toBe("N");
  expect(stream.mock.calls).toEqual([]);
});

test("split startup and typed frames wait for all bytes and buffered messages retain order", async () => {
  const stream = vi.spyOn(db, "execProtocolRawStream");
  const start = startup({});
  await exchange({ chunks: [start.subarray(0, 4), start.subarray(4, 8), start.subarray(8)], complete: bytes => readyCount({ bytes }) === 1 });
  const first = query({ text: "SELECT 11" });
  const second = query({ text: "SELECT 22" });
  await exchange({ chunks: [first.subarray(0, 3), first.subarray(3, 5), Buffer.concat([first.subarray(5), second])], complete: bytes => readyCount({ bytes }) === 2 });
  expect(stream.mock.calls.map(([bytes]) => Buffer.from(bytes))).toEqual([start, first, second]);
});

test("a buffered startup followed immediately by a typed query forwards each frame once", async () => {
  const stream = vi.spyOn(db, "execProtocolRawStream");
  const start = startup({});
  const message = query({ text: "SELECT 33" });
  await exchange({ chunks: [Buffer.concat([start, message])], complete: bytes => readyCount({ bytes }) === 2 });
  expect(stream.mock.calls.map(([bytes]) => Buffer.from(bytes))).toEqual([start, message]);
});
