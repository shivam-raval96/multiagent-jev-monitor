import { build } from 'esbuild';
import { mkdir, readFile, copyFile } from 'node:fs/promises';

const assets = {};
for (const [path, file, type] of [
  ['/', 'index.html', 'text/html; charset=utf-8'],
  ['/app.js', 'app.js', 'text/javascript'],
  ['/heatmap.js', 'heatmap.js', 'text/javascript'],
  ['/style.css', 'style.css', 'text/css'],
]) assets[path] = { type, body: await readFile(new URL(`../public/${file}`, import.meta.url), 'utf8') };
await build({
  entryPoints: ['worker.js'], outfile: 'dist/server/index.js', bundle: true,
  format: 'esm', platform: 'browser', target: 'es2022',
  plugins: [{ name: 'site-assets', setup(b) {
    b.onResolve({ filter: /^site-assets$/ }, () => ({ path: 'site-assets', namespace: 'assets' }));
    b.onLoad({ filter: /.*/, namespace: 'assets' }, () => ({ contents: `export default ${JSON.stringify(assets)}`, loader: 'js' }));
  } }],
});
await mkdir('dist/.openai', { recursive: true });
await copyFile('.openai/hosting.json', 'dist/.openai/hosting.json');
console.log('Built hosted Worker with embedded application assets.');
