import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
  files: 'out/test/integration/**/*.test.js',
  version: 'stable',
  mocha: {
    ui: 'tdd',
    timeout: 120000,
    color: true
  },
  launchArgs: ['--disable-extensions', '--disable-gpu']
});
