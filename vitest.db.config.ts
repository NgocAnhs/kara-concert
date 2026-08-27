import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/db/**/*.test.ts'],
    environment: 'node',
    fileParallelism: false,
    maxWorkers: 1,
    sequence: { concurrent: false },
  },
});
