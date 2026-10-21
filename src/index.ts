import path from 'node:path';
import process from 'node:process';

import type { Logger, PluginOption } from 'vite';

import MetaPlugin from './MetaPlugin';
import { type MetaPluginOption, Names } from './types';
import { buildError, greenText } from './utils';

export type PluginConfig = {
  readonly command: 'build' | 'serve';
  readonly logger: Logger;
  readonly publicDir: string;
  readonly outDir: string;
};

function createError(err: unknown): Error {
  const error = buildError(err);
  return new Error('[vite-plugin-meta] ' + error.message, { cause: err });
}

type MetaPluginConfig = Partial<MetaPluginOption> & {
  readonly convert?: boolean;
  readonly audioDuration?: boolean;
};

const metaPlugin = (pluginConfig: MetaPluginConfig = {}): PluginOption => {
  const { convert = true, audioDuration = true, ...options } = pluginConfig;
  let plugin: MetaPlugin;
  let config: PluginConfig;

  return {
    name: 'vite-plugin-meta',
    async configResolved(viteConfig) {
      config = {
        command: viteConfig.command,
        logger: viteConfig.logger,
        outDir: path.resolve(viteConfig.root, viteConfig.build.outDir),
        publicDir: viteConfig.publicDir,
      };
      plugin = new MetaPlugin({
        version: process.env['GAME_VERSION'],
        ...options,
        storageDir: path.resolve(viteConfig.root, options.storageDir ?? Names.storageDir),
      });
      // Only development writes to public; production metadata belongs in outDir.
      if (config.command !== 'serve' || !config.publicDir) return;
      try {
        plugin.selectFiles(config.publicDir);
        if (audioDuration) await plugin.audioDurationProcess();
        await plugin.writeConfig(false, config.publicDir);
      } catch (err) {
        throw createError(err);
      }
    },

    async closeBundle() {
      if (config.command !== 'build') return;
      const { logger, outDir } = config;
      logger.info('\n' + greenText('Metaprocesses started'));
      try {
        if (convert && config.publicDir) await plugin.convertProcess(config.publicDir);
        plugin.selectFiles(outDir);
        if (audioDuration) await plugin.audioDurationProcess();
        if (convert) await plugin.transferProcess();
        await plugin.writeConfig(convert, outDir);
        logger.info(greenText('✓') + ' metaprocesses completed\n');
      } catch (err) {
        throw createError(err);
      }
    },
  };
};

export default metaPlugin;
