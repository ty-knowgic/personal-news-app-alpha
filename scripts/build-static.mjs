// 静的サイト版（GitHub Pages など）を site/ に作る。画面（public/）と、ブラウザで API を代わりに答えるスクリプトをまとめる。
// 記事のデータ（site/data/*.json）は scripts/export-data.ts が書き出す。
import { build } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const site = path.join(root, 'site');

// data/ は残して、画面とスクリプトだけ作り直す
await mkdir(path.join(site, 'data'), { recursive: true });
await cp(path.join(root, 'public'), site, { recursive: true });
await build({
  entryPoints: [path.join(root, 'src/browser/main.ts')],
  outfile: path.join(site, 'static-api.js'),
  bundle: true,
  format: 'iife',
  target: 'es2020',
  platform: 'browser',
  minify: true,
  logLevel: 'info'
});

const indexPath = path.join(site, 'index.html');
const html = await readFile(indexPath, 'utf8');
if (!html.includes('<script src="app.js">')) throw new Error('index.html に app.js の読み込みが見つかりません');
await writeFile(indexPath, html.replace('<script src="app.js">', '<script src="static-api.js"></script>\n    <script src="app.js">'));
console.log('site/ を作成しました');
