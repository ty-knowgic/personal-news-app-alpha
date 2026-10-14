#!/usr/bin/env node
/**
 * 翻訳ファイル（public/locales/*.json）の点検。英語（en.json）を基準に、
 * 訳の抜け・余分なキー・{置き換え}の食い違い・<strong> などの HTML の欠落を探す。
 * 使い方: npm run check:locales
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const dir = path.join(path.dirname(new URL(import.meta.url).pathname), '../public/locales');
const read = async name => JSON.parse(await readFile(path.join(dir, name), 'utf8'));
const forms = value => (typeof value === 'string' ? [value] : Object.values(value));
const placeholders = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]);
const tags = text => (text.match(/<\/?\w+>/g) ?? []).sort().join('');

const en = await read('en.json');
const sources = await read('sources.json');
const problems = [];
const files = (await readdir(dir)).filter(name => name.endsWith('.json') && !['en.json', 'sources.json'].includes(name));

for (const file of files) {
  const messages = await read(file);
  const label = file.replace('.json', '');
  for (const key of Object.keys(messages)) {
    if (!(key in en) && !(key in sources)) problems.push(`${label}: 余分なキー「${key}」`);
  }
  for (const [key, source] of Object.entries(en)) {
    const translated = messages[key];
    if (translated === undefined) { problems.push(`${label}: 訳がない「${key}」`); continue; }
    if (typeof translated !== 'string' && !('other' in translated)) problems.push(`${label}: 複数形に other がない「${key}」`);
    const allowed = new Set(forms(source).flatMap(placeholders));
    const required = typeof source === 'string' ? new Set(placeholders(source)) : null;
    for (const text of forms(translated)) {
      if (typeof text !== 'string' || !text.trim()) { problems.push(`${label}: 空の訳「${key}」`); continue; }
      const used = new Set(placeholders(text));
      for (const name of used) if (!allowed.has(name)) problems.push(`${label}: 未知の {${name}}「${key}」`);
      if (required) for (const name of required) if (!used.has(name)) problems.push(`${label}: {${name}} が抜けている「${key}」`);
      if (tags(text) !== tags(forms(source)[0])) problems.push(`${label}: HTML タグが英語と違う「${key}」`);
    }
  }
}

if (problems.length) {
  console.error(problems.join('\n'));
  console.error(`\n${problems.length} 件の問題（${files.length} 言語）`);
  process.exit(1);
}
console.log(`翻訳ファイル ${files.length} 言語（基準 ${Object.keys(en).length} 文言）: 問題なし`);
