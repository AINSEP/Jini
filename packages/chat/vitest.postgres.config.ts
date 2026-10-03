import { defineConfig, mergeConfig } from 'vitest/config';
import base from './vitest.config.js';
const config=mergeConfig(base,defineConfig({test:{include:['src/store/**/*.postgres.test.ts']}}));
config.test!.exclude=['**/node_modules/**','**/dist/**'];
export default config;
