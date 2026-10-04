// Unit tests run in plain Node; the integration tests start a real OpenSSH sshd of this account on
// 127.0.0.1 (test/sshd.ts) and skip themselves where none is installed, saying so.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
