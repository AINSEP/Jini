import { defineConfig } from "vitest/config";
// One coverage run over every vitest suite of the package. `vitest.config.ts` (React only, jsdom) and
// `vitest.kernel.config.ts` (node) each see a slice, so measuring either alone misreports the package.
// `all: true` + an explicit include keeps untouched files in the denominator; nothing is excluded but tests.
export default defineConfig({
  test: {
    environment: "node",
    environmentMatchGlobs: [["src/react/**", "jsdom"]],
    setupFiles: ["./src/react/__tests__/setup.ts"],
    include: ["src/**/*.vitest.test.ts", "src/react/**/*.test.tsx"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      all: true,
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/__tests__/**"],
    },
  },
});
