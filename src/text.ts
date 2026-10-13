/** フィードの文章の整形（サーバーでもブラウザでも使う） */

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** 二重にエスケープされたフィード（「&amp;amp;」など）の文字参照を戻す */
export function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === '#') {
      const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(point) && point > 0 && point < 0x110000 ? String.fromCodePoint(point) : match;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? match;
  });
}

export function cleanFeedText(value: string): string {
  return decodeEntities(value)
    .replace(/\[(画像|動画)[^\]]*(\]|$)/g, ' ')
    .replace(/^\s*\[[^\]]{1,60}\]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

