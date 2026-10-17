import { createRequire } from 'node:module';

// robots-parser は CommonJS のため、型の都合で require で読み込む
interface Robot { isAllowed(url: string, userAgent?: string): boolean | undefined }
const robotsParser = createRequire(import.meta.url)('robots-parser') as (url: string, text: string) => Robot;

/**
 * 発信元のページを取得する前に robots.txt を確認する（RFC 9309）。
 * robots.txt が無い（4xx）場合は取得してよい。応答が得られない（5xx・通信エラー）場合は、取得を控える
 */
export const CRAWLER_NAME = 'SivryBot';
export const USER_AGENT = `Mozilla/5.0 (compatible; ${CRAWLER_NAME}/1.0; +https://github.com/ty-knowgic/sivry-app)`;

const TTL_MS = 6 * 60 * 60 * 1000;
const FAILURE_TTL_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 5000;

interface Entry { robot: Robot | null; allowAll: boolean; expires: number }
const cache = new Map<string, Entry>();

async function load(origin: string): Promise<Entry> {
  const robotsUrl = `${origin}/robots.txt`;
  try {
    const response = await fetch(robotsUrl, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (response.ok) {
      const text = (await response.text()).slice(0, 512 * 1024);
      return { robot: robotsParser(robotsUrl, text), allowAll: false, expires: Date.now() + TTL_MS };
    }
    if (response.status >= 400 && response.status < 500) return { robot: null, allowAll: true, expires: Date.now() + TTL_MS };
  } catch {
    // 通信エラーは下で控える扱いにする
  }
  return { robot: null, allowAll: false, expires: Date.now() + FAILURE_TTL_MS };
}

export async function isAllowedByRobots(url: string): Promise<boolean> {
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    return false;
  }
  let entry = cache.get(origin);
  if (!entry || entry.expires < Date.now()) {
    entry = await load(origin);
    cache.set(origin, entry);
  }
  if (entry.allowAll) return true;
  return entry.robot ? entry.robot.isAllowed(url, CRAWLER_NAME) !== false : false;
}
