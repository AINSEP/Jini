import { defineConfig, mergeConfig } from "vitest/config";
import base from "./vitest.config.js";

/** Real Postgres is opt-in and must fail when the server is unavailable. */
const config = mergeConfig(base, defineConfig({ test: { include: ["src/**/*.postgres.test.ts"] } }));
// mergeConfig concatenates arrays; replace the default Postgres exclusion for this opt-in suite.
config.test!.exclude = ["**/node_modules/**", "**/dist/**"];
export default config;
