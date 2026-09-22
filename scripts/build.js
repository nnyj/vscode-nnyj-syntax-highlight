const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const esbuild = require('esbuild');

const root_dir = path.resolve(__dirname, '..');
const output_dir = path.join(root_dir, 'dist');
const mermaid_source = path.join(root_dir, 'node_modules/mermaid/dist');
const mermaid_target = path.join(output_dir, 'mermaid');

execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '--noEmit'], {
  cwd: root_dir,
  stdio: 'inherit',
});

esbuild.buildSync({
  entryPoints: [path.join(root_dir, 'src/extension.js')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode'],
  outfile: path.join(output_dir, 'extension.js'),
});

if (path.dirname(mermaid_target) !== output_dir) throw new Error('Invalid Mermaid output path');
fs.rmSync(mermaid_target, { recursive: true, force: true });
fs.mkdirSync(mermaid_target, { recursive: true });
fs.copyFileSync(path.join(mermaid_source, 'mermaid.esm.min.mjs'), path.join(mermaid_target, 'mermaid.esm.min.mjs'));
fs.cpSync(path.join(mermaid_source, 'chunks/mermaid.esm.min'), path.join(mermaid_target, 'chunks/mermaid.esm.min'), {
  recursive: true,
  filter: file => !file.endsWith('.map'),
});
fs.copyFileSync(path.join(root_dir, 'node_modules/mermaid/LICENSE'), path.join(mermaid_target, 'LICENSE'));
