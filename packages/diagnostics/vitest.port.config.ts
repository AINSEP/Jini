import { defineConfig } from 'vitest/config';

// Explicit fixture run for hosts with permission to bind ports and Chromium installed.
export default defineConfig({ test: { include: ['src/__tests__/*.port-check.ts'] } });
