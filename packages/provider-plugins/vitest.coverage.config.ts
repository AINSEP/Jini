import { readdirSync, readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

// The baseline stays explicitly unmeasured until a permitted run records package totals.
const gateDirectory = new URL("./coverage-gates/", import.meta.url);
const thresholds = Object.assign({}, ...readdirSync(gateDirectory).filter(name => name.endsWith(".json")).sort().map(name => {
  const gate = JSON.parse(readFileSync(new URL(name, gateDirectory), "utf8"));
  return name === "baseline.json" ? gate.thresholds : gate;
}));

export default defineConfig({
  // Same temp-root allowance as vitest.config.ts: the artifact tests import .mjs files built under os.tmpdir().
  server: { fs: { allow: [fileURLToPath(new URL("../..", import.meta.url)), tmpdir()] } },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      all: true,
      include: ["src/payments-stripe/**"],
      exclude: ["src/**/__tests__/**"],
      thresholds,
    },
  },
});
