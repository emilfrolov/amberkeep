import { build } from 'esbuild';
import { packExtension } from '@anthropic-ai/mcpb/cli';
import { validateManifest } from '@anthropic-ai/mcpb/node';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const distribution = path.join(root, 'dist');
const bundle = path.join(distribution, 'bundle');
try {
  if ((await fs.lstat(distribution)).isSymbolicLink()) throw new Error('Refusing a symlinked distribution directory');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
await fs.rm(bundle, { recursive: true, force: true });
await fs.mkdir(bundle, { recursive: true });

const manifest = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8'));
const packageJson = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
if (manifest.version !== packageJson.version) throw new Error('Desktop extension versions do not match');

const output = await build({
  absWorkingDir: root,
  entryPoints: ['src/server.js'], outfile: path.join(distribution, 'server.js'),
  bundle: true, platform: 'node', format: 'cjs', target: 'node18',
  minify: false, legalComments: 'inline', metafile: true,
});

const notices = new Map();
for (const input of Object.keys(output.metafile.inputs)) {
  if (!input.includes('node_modules/')) continue;
  let directory = path.dirname(path.resolve(root, input));
  while (directory !== root && directory !== path.dirname(directory)) {
    try {
      const metadata = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'));
      if (metadata.name && metadata.version) {
        const key = `${metadata.name}@${metadata.version}`;
        if (!notices.has(key)) {
          let license = '';
          for (const filename of ['LICENSE', 'LICENSE.txt', 'LICENSE.md', 'license', 'license.txt', 'COPYING']) {
            try { license = await fs.readFile(path.join(directory, filename), 'utf8'); break; } catch { /* Try next conventional name. */ }
          }
          notices.set(key, `${key}\nDeclared license: ${metadata.license || 'See package source'}\n\n${license || 'No separate license file was supplied in this npm package.'}`);
        }
        break;
      }
    } catch { /* Continue to the package root. */ }
    directory = path.dirname(directory);
  }
}

await Promise.all([
  fs.copyFile(path.join(distribution, 'server.js'), path.join(bundle, 'server.js')),
  fs.copyFile(path.join(root, 'manifest.json'), path.join(bundle, 'manifest.json')),
  fs.copyFile(path.join(root, 'README.md'), path.join(bundle, 'README.md')),
  fs.copyFile(path.join(root, '../assets/icon.png'), path.join(bundle, 'icon.png')),
  fs.copyFile(path.join(root, '../LICENSE'), path.join(bundle, 'LICENSE')),
  fs.writeFile(path.join(bundle, 'THIRD-PARTY-NOTICES.txt'), [...notices.entries()].sort().map(([, text]) => text).join('\n\n' + '='.repeat(72) + '\n\n') + '\n'),
]);
if (!validateManifest(path.join(bundle, 'manifest.json'))) throw new Error('MCPB manifest validation failed');
const destination = path.join(distribution, 'amberkeep-desktop.mcpb');
if (!await packExtension({ extensionPath: bundle, outputPath: destination, silent: true })) {
  throw new Error('MCPB packaging failed');
}
console.log(JSON.stringify({ version: manifest.version, server: path.join(distribution, 'server.js'), mcpb: destination }));
