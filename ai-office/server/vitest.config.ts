import os from 'node:os';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 60000,
    fileParallelism: false,
    env: {
      DATA_DIR: path.join(os.tmpdir(), `ai-office-test-${process.pid}`),
      DEMO_STEP_DELAY_MS: '0',
      NODE_ENV: 'test',
      ANTHROPIC_API_KEY: '',
    },
  },
});
