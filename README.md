# vite-plugin-meta

## Plugin

```ts
import metaPlugin from 'vite-plugin-meta';

metaPlugin({ fileChangeLog: true, quality: 80, prefixes: [0.75, 1], storageDir: 'assets-cache', soundExt: '.mp3', }),

```

## CLI

```bash
npx file-convert --fileChangeLog --quality 80 --prefixes 0.75,1 --storageDir assets-cache --soundExt .mp3
```

## Metadata lifecycle

The dev server generates metadata in Vite's public directory. Production builds
write metadata only to the output directory, preserving files used by a running
dev server. Metadata and cache manifests are replaced atomically. Resource paths
are resolved relative to the Vite project root, including nested public, output,
and cache directories. Generation failures reject startup or the build.

## Development

Use Node.js 22 (configured in .npmrc), then run pnpm install, pnpm lint,
pnpm test, and pnpm build. Tests use node:test and real Vite servers and builds.
