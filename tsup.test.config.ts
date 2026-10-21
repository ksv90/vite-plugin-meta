export default {
  entry: ['tests/meta.test.ts'],
  format: ['esm'],
  target: 'node22',
  outDir: '.test-dist',
  clean: true,
  external: ['vite'],
  removeNodeProtocol: false,
};
