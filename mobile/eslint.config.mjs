import { defineConfig, globalIgnores } from 'eslint/config';
import expoConfig from 'eslint-config-expo/flat.js';

export default defineConfig([
  globalIgnores(['.expo/**', 'dist/**', 'node_modules/**', 'web-build/**']),
  expoConfig,
]);
