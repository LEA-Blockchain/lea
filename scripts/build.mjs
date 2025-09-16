import esbuild from 'esbuild';
import { exec } from 'node:child_process';

const baseConfig = {
  bundle: true,
  platform: 'node',
  target: ['node20'],
  sourcemap: false,
  // Bundle all dependencies by default; selectively externalize below
  packages: 'bundle',
  external: [
    '@getlea/keygen'
  ],
};

const cliConfig = {
  ...baseConfig,
  entryPoints: ['bin/lea.mjs'],
  outfile: 'dist/cli.mjs',
  format: 'esm',
  banner: { js: '#!/usr/bin/env node' },
};

async function chmodx(file) {
  await new Promise((resolve, reject) => {
    exec(`chmod +x ${file}`, (err) => (err ? reject(err) : resolve()));
  });
}

async function build() {
  try {
    await esbuild.build(cliConfig);
    await chmodx('dist/cli.mjs');
    console.log('[lea] Build finished successfully.');
  } catch (e) {
    console.error('[lea] Build failed:', e);
    process.exit(1);
  }
}

build();
