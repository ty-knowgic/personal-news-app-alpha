import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { clearMatcherCache, DEFAULT_PROFILE, DEFAULT_PROFILE_ID, ProfileSchema, withDefaultDescriptions } from './profile.js';
import type { Profile } from './profile.js';

/** サーバー側のプロフィールの保存（ファイル）。ブラウザ版は localStorage に保存する */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILE_DIR = path.join(__dirname, '../data/profiles');
const cache = new Map<string, Profile>();

function profilePath(id: string): string {
  return path.join(PROFILE_DIR, `${id.replace(/[^a-z0-9-]/gi, '')}.json`);
}

export async function loadProfile(id = DEFAULT_PROFILE_ID): Promise<Profile> {
  const cached = cache.get(id);
  if (cached) return cached;
  let profile = DEFAULT_PROFILE;
  try {
    profile = withDefaultDescriptions(ProfileSchema.parse(JSON.parse(await readFile(profilePath(id), 'utf8'))));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`[profile] 読み込みに失敗したため初期設定を使います: ${(error as Error).message}`);
    }
  }
  cache.set(id, profile);
  return profile;
}

/** 保存済みのプロフィールの ID の一覧（初期設定のままなら default だけ） */
export async function listProfileIds(): Promise<string[]> {
  try {
    const ids = (await readdir(PROFILE_DIR)).filter(name => name.endsWith('.json')).map(name => name.slice(0, -5));
    return ids.includes(DEFAULT_PROFILE_ID) ? ids : [DEFAULT_PROFILE_ID, ...ids];
  } catch {
    return [DEFAULT_PROFILE_ID];
  }
}

export async function saveProfile(input: unknown, id = DEFAULT_PROFILE_ID): Promise<Profile> {
  const profile = ProfileSchema.parse(input);
  await mkdir(PROFILE_DIR, { recursive: true });
  await writeFile(profilePath(id), JSON.stringify(profile, null, 2));
  cache.set(id, profile);
  clearMatcherCache();
  return profile;
}

