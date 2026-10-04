import { defineConfig } from 'tsup';
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: { resolve: true },
  noExternal: [/^@flagship\//],
  clean: true,
});
