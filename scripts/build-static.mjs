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
// ブラウザが古い app.js と新しい static-api.js のように混ぜて使わないよう、配信ごとに変わる版をファイルの URL に付ける
const version = (process.env.GITHUB_SHA ?? String(Date.now())).slice(0, 10);
const versioned = html
  .replace('<script src="app.js">', '<script src="static-api.js"></script>\n    <script src="app.js">')
  .replace(/(<script src="(?:i18n|static-api|app)\.js)"/g, `$1?v=${version}"`)
  .replace('href="styles.css"', `href="styles.css?v=${version}"`);
await writeFile(indexPath, versioned);
console.log('site/ を作成しました');
