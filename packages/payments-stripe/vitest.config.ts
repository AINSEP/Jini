import { defineConfig } from "vitest/config";
// Node environment: the provider is node-only (node:crypto HMAC for webhook signatures).
// Every source file sits at `src/*.ts`; tests and fixtures live under `src/__tests__/`.
export default defineConfig({ test: { environment: "node", include: ["src/**/*.test.ts"], coverage: { provider: "v8", reporter: ["text"], include: ["src/*.ts"] } } });
