import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    pool: 'vmThreads',
    include: ['tests/**/*.test.js'],
    setupFiles: ['tests/setup/electron-mock.js'],
    coverage: {
      provider: 'v8',
      include: [
        'src/main/store.js',
        'src/main/organizer/agent.js',
        'src/main/organizer/embeddings.js',
      ],
      reporter: ['text', 'lcov'],
    },
  },
});
