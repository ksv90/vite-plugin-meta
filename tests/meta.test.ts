import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import sharp from 'sharp';
import { build, createServer } from 'vite';
import MetaPlugin from '../src/MetaPlugin';
import metaPlugin from '../src/index';
import { writeConfig } from '../src/processes';

const fixture = async (context: TestContext) => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'vite-meta-test-')));
  context.after(() => rm(root, { recursive: true, force: true }));
  return root;
};

const json = async (file: string) => JSON.parse(await readFile(file, 'utf8'));

test('writing metadata preserves previous destinations, converted audio, and resource selection', async (context) => {
  const root = await fixture(context);
  const publicDir = path.join(root, 'public');
  const outDir = path.join(root, 'dist');
  const storageDir = path.join(root, 'cache');
  await Promise.all([publicDir, outDir, storageDir].map(dir => mkdir(dir)));
  const plugin = new MetaPlugin({ storageDir, soundExt: '.mp3' });
  await plugin.writeConfig(false, publicDir);
  const devMeta = await readFile(path.join(publicDir, 'meta.json'), 'utf8');
  await writeFile(path.join(outDir, 'sound.mp3'), 'original');
  for (const format of ['mp3', 'ogg', 'm4a']) {
    await writeFile(path.join(storageDir, `sound.${format}`), format);
  }
  plugin.selectFiles(outDir);
  await plugin.writeConfig(true, outDir);
  assert.equal(await readFile(path.join(publicDir, 'meta.json'), 'utf8'), devMeta);
  assert.equal(await readFile(path.join(outDir, 'sound.mp3'), 'utf8'), 'original');
  await plugin.transferProcess();
  for (const format of ['mp3', 'ogg', 'm4a']) {
    assert.equal(await readFile(path.join(outDir, `sound.${format}`), 'utf8'), format);
  }
  assert.equal((await json(path.join(outDir, 'meta.json'))).prod, true);
});

test('readers always see complete JSON during repeated metadata writes', async (context) => {
  const root = await fixture(context);
  const file = path.join(root, 'nested', 'meta.json');
  const payload = 'x'.repeat(100_000);
  await writeConfig(file, { iteration: -1, payload });
  let finished = false;
  const writer = async () => {
    try {
      for (let iteration = 0; iteration < 20; iteration += 1) {
        await writeConfig(file, { iteration, payload });
      }
    } finally {
      finished = true;
    }
  };
  const reader = async () => {
    do {
      assert.equal((await json(file)).payload, payload);
    } while (!finished);
  };
  await Promise.all([writer(), reader()]);
  assert.equal((await json(file)).iteration, 19);
  assert.deepEqual(await readdir(path.dirname(file)), ['meta.json']);
});

test('a failed metadata write preserves the previous file and leaves no temporary files', async (context) => {
  const root = await fixture(context);
  const file = path.join(root, 'meta.json');
  await writeConfig(file, { previous: true });
  await assert.rejects(writeConfig(file, { invalid: BigInt(1) }), /writeConfig .* failed/);
  assert.deepEqual(await json(file), { previous: true });
  assert.deepEqual(await readdir(root), ['meta.json']);
});

for (const base of ['/', '/game/']) {
  test(`dev metadata survives repeated real builds and server restart (base=${base})`, async (context) => {
    const root = await fixture(context);
    const publicDir = path.join(root, 'resources', 'public');
    const metaPath = path.join(publicDir, 'meta.json');
    const outDir = path.join(root, 'build', 'release');
    await mkdir(path.join(publicDir, 'textures'), { recursive: true });
    await writeFile(path.join(root, 'index.html'), '<!doctype html><title>Game</title>');
    const image = path.join(publicDir, 'textures', 'symbol.png');
    await sharp({ create: { width: 4, height: 4, channels: 4, background: '#ff0000' } }).png().toFile(image);
    const originalImage = await readFile(image);
    const server = await createServer({
      configFile: false,
      root,
      base,
      publicDir,
      plugins: [metaPlugin({ audioDuration: false, soundExt: '.mp3', version: 'dev' })],
      server: { host: '127.0.0.1', port: 0 },
      optimizeDeps: { noDiscovery: true, include: [] },
      logLevel: 'silent',
    });
    context.after(() => server.close());
    await server.listen();
    const url = () => {
      const address = server.httpServer?.address();
      assert.ok(address && typeof address !== 'string');
      return `http://127.0.0.1:${address.port}${base}meta.json?v=old-tab`;
    };
    const devMeta = await readFile(metaPath, 'utf8');
    assert.equal(JSON.parse(devMeta).prod, false);
    for (const version of ['build-1', 'build-2']) {
      await build({
        configFile: false,
        root,
        publicDir,
        plugins: [metaPlugin({ audioDuration: false, soundExt: '.mp3', version, storageDir: 'nested/cache' })],
        build: { outDir },
        logLevel: 'silent',
      });
      assert.equal(await readFile(metaPath, 'utf8'), devMeta);
      assert.deepEqual(await readFile(image), originalImage);
      const response = await fetch(url(), { headers: { connection: 'close' } });
      assert.match(response.headers.get('content-type') ?? '', /application\/json/);
      assert.deepEqual(await response.json(), JSON.parse(devMeta));
      const prod = await json(path.join(outDir, 'meta.json'));
      assert.equal(prod.prod, true);
      assert.equal(prod.gameVersion, version);
      for (const format of prod.textures.formats) {
        await access(path.join(outDir, 'textures', `symbol${format}`));
      }
    }
    await server.restart();
    assert.deepEqual(await (await fetch(url(), { headers: { connection: 'close' } })).json(), JSON.parse(devMeta));
    const head = await fetch(url(), { method: 'HEAD', headers: { connection: 'close' } });
    assert.match(head.headers.get('content-type') ?? '', /application\/json/);
    assert.equal(await head.text(), '');
  });
}

test('a standalone build creates output metadata without writing to public', async (context) => {
  const root = await fixture(context);
  await mkdir(path.join(root, 'public'));
  await writeFile(path.join(root, 'index.html'), '<!doctype html><title>Game</title>');
  await build({
    configFile: false,
    root,
    plugins: [metaPlugin({ convert: false, audioDuration: false })],
    logLevel: 'silent',
  });
  assert.equal((await json(path.join(root, 'dist', 'meta.json'))).prod, false);
  await assert.rejects(access(path.join(root, 'public', 'meta.json')), { code: 'ENOENT' });
});

test('metadata generation errors reject server startup instead of leaving it serving HTML', async (context) => {
  const root = await fixture(context);
  await mkdir(path.join(root, 'public'));
  await writeFile(path.join(root, 'public', 'blocked'), 'file');
  await assert.rejects(createServer({
    configFile: false,
    root,
    plugins: [metaPlugin({ audioDuration: false, metaConfigName: 'blocked/meta.json' })],
    logLevel: 'silent',
  }), /\[vite-plugin-meta\]/);
});

test('metadata generation errors reject the production build', async (context) => {
  const root = await fixture(context);
  await mkdir(path.join(root, 'public'));
  await writeFile(path.join(root, 'public', 'blocked'), 'file');
  await writeFile(path.join(root, 'index.html'), '<!doctype html><title>Game</title>');
  await assert.rejects(build({
    configFile: false,
    root,
    plugins: [metaPlugin({ convert: false, audioDuration: false, metaConfigName: 'blocked/meta.json' })],
    logLevel: 'silent',
  }), /\[vite-plugin-meta\]/);
});
