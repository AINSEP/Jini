import { defineConfig } from "vitest/config";
// The payments kernel's node-environment suite (money, contracts, ledger, accounting, testkit).
// Kept apart from `vitest.config.ts`, whose jsdom setup belongs to the React panel only.
export default defineConfig({ test: { environment: "node", include: ["src/**/*.vitest.test.ts"], coverage: { provider: "v8", reporter: ["text"], all: false } } });
