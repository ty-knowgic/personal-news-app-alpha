/**
 * 記事・トピックのベクトルに関する、サーバーでもブラウザでも動く部分（Node 固有の API を使わない）。
 * ベクトルは長さ 1 に正規化済みの Float32 で、内積がそのままコサイン類似度になる。
 */

/** 記事 ID → ベクトル（サーバーでは embeddings.ts が、ブラウザでは静的データの読み込みが埋める） */
export const itemVectors = new Map<string, Float32Array>();

export function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += a[i] * b[i];
  return sum;
}

/** Base64 のベクトルを戻す */
export function decodeVector(base64: string): Float32Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

/** 2つの記事の意味の近さ（どちらかが未処理なら undefined） */
export function itemSimilarity(a: string, b: string): number | undefined {
  const va = itemVectors.get(a);
  const vb = itemVectors.get(b);
  return va && vb && va.length === vb.length ? dot(va, vb) : undefined;
}

export interface SemanticScorer {
  /** 記事と関心トピックの意味の近さ（コサイン類似度）。どちらかのベクトルがない場合は undefined */
  similarity(itemId: string, topicId: string): number | undefined;
  threshold: number;
}

/** トピック ID → ベクトル から、記事との類似度を返す関数を作る。ベクトルが1つもなければ null（キーワードだけで判定） */
export function createScorer(topicVectors: Map<string, Float32Array>, threshold: number): SemanticScorer | null {
  if (!topicVectors.size) return null;
  return {
    threshold,
    similarity(itemId, topicId) {
      const topic = topicVectors.get(topicId);
      const item = itemVectors.get(itemId);
      return topic && item && topic.length === item.length ? dot(topic, item) : undefined;
    }
  };
}

/** トピックの説明文から、事前計算したベクトルを引くための短いキー（サーバー側の書き出しとブラウザで同じ値になる） */
export function textKey(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + code, 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}
