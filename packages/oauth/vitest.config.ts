import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node', include: ['tests/**/*.test.ts'], maxWorkers: 1, minWorkers: 1, coverage: { provider: 'v8', include: ['src/**'] } } });
