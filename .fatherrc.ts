import { defineConfig } from 'father';

export default defineConfig({
  sourcemap: true,
  esm: {
    input: 'src',
  },
  cjs: {
    input: 'src',
  },
  umd: {
    entry: 'src'
  },
  prebundle: {
    deps: {}
  },
});
