import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root_dir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts', 'src/**/*_test.js', 'src/**/*_test.ts'],
  },
  resolve: {
    alias: { vscode: path.resolve(root_dir, 'src/inline/test/__mocks__/vscode.ts') },
  },
});
