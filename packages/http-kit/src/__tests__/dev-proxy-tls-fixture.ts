// Self-signed localhost fixture; used only by hermetic dev-proxy tests.
// Generated per test process rather than committed, so no private-key block is ever tracked in the
// repository. node:crypto cannot issue an X.509 certificate, so this uses `openssl req`. The proxy's
// dev upstream agent skips verification (`rejectUnauthorized: false`), so the certificate's
// identity does not matter, only that the upstream speaks real TLS.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function generateSelfSignedLocalhostTls(): { key: Buffer; cert: Buffer } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dev-proxy-tls-"));
  try {
    const keyPath = path.join(dir, "key.pem");
    const certPath = path.join(dir, "cert.pem");
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", keyPath, "-out", certPath, "-days", "1", "-subj", "/CN=localhost"], { stdio: "pipe" });
    return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export const DEV_PROXY_TLS = generateSelfSignedLocalhostTls();
