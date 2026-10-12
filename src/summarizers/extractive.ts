import type { SummaryDraft, SummaryInput, Summarizer } from './types.js';

/**
 * 生成AIを使わない抽出型の要約。
 * 本文を文に分け、見出しとの重なり・文書内での中心性（TextRank）・冒頭からの位置で採点し、
 * 重要な文をそのまま抜き出す。文章を書き換えないため、本文にないことを書くことはない。
 */

const CJK_CHAR = '\\u3000-\\u30ff\\u3400-\\u9fff\\uff00-\\uffef';
const CJK = new RegExp(`[${CJK_CHAR}]`);
const CJK_RUN = new RegExp(`[${CJK_CHAR}]+`, 'g');

// 本文の後半にある会社概要・問い合わせ先・免責事項などは要約の対象外にする
const SECTION_END = /^[【■◆●\[]?\s*(会社概要|企業概要|団体概要|本件に関する(お)?問(い)?合(わ)?せ|(報道関係者|報道機関)(の|様)?(からの)?(お)?問(い)?合(わ)?せ|お?問(い)?合(わ)?せ先?|問合せ先|関連リンク|参考資料|About\b|Media Contacts?|Contacts?:|Investor Contacts?|Forward[- ]Looking Statements|Safe Harbor|Cautionary (Note|Statement)|SOURCE\b)/i;
const NOISE = /^(以\s*上|※|＊|TEL|Tel|電話|FAX|E-?mail|URL|https?:\/\/|〒|Photo:|Image:)|[\w.-]+@[\w-]+\.[\w.]+|\d{2,4}-\d{2,4}-\d{3,4}/;
// 「株式会社〇〇（本社：東京都…、代表取締役：…）は」のような会社情報の括弧書きは、要旨に不要なので省く
const COMPANY_DETAILS = /[（(][^（）()]{0,120}(本社|所在地|代表取締役|代表者|証券コード|URL|https?:)[^（）()]{0,120}[）)]/g;
// 通信社配信の冒頭にある「都市名, 日付 /PRNewswire/ --」などの配信表記
const WIRE_DATELINE = /^[^。]{0,120}?\/\s*(PRNewswire(-[A-Za-z]+)?|Business Wire|GLOBE NEWSWIRE|ACCESS Newswire)\s*\/\s*[-–—]+\s*/i;
// 会社の理念・事業紹介・問い合わせ誘導など、どの発表にも載る定型文
const BOILERPLATE_SENTENCE = /(という想い|をミッション|をビジョン|を提供しています。?$|を展開しています。?$|を目指しています。?$|is a leading|is the world'?s leading|for more information|travel insurance could be invalidated|visit (us at )?(www\.|https?:)|learn more at)/i;
// 抜き出した文の冒頭の接続詞（単独で読むと不自然なため、要点では省く）
const LEADING_CONNECTIVE = /^(また|さらに|なお|一方|そして|加えて|Additionally|Also|Furthermore|Moreover|In addition)[、,]\s*/i;
const FACT = /[0-9０-９]|[一二三四五六七八九十百千万億兆]+(円|件|人|社|%|％)|億|万円|％|%|年|月|日|期|倍/;
const BULLET = /^[・●○◆◇■□▶▷►\-–—•*]|^[①-⑳]|^\(?\d{1,2}[).]\s/;
const EN_STOPWORDS = new Set('the of and to in for on with by at from as is are was were be been that this its it an or will has have their our we which who about into more than also'.split(' '));

interface Sentence {
  text: string;
  index: number;
  isBullet: boolean;
  terms: Map<string, number>;
}

/** PDF 由来の文字間の空白や行の途中の改行を整え、段落ごとのテキストにする */
export function cleanArticleText(raw: string): string[] {
  const text = raw
    .replace(/\r/g, '')
    .replace(/\\n/g, '\n')
    // 「金 融 庁」「2026 年」のような、PDF 由来の文字間の空白を詰める
    .replace(new RegExp(`(?<=[${CJK_CHAR}0-9])[ \\t]+(?=[${CJK_CHAR}])`, 'g'), '')
    .replace(new RegExp(`(?<=[${CJK_CHAR}])[ \\t]+(?=[0-9])`, 'g'), '');

  const paragraphs: string[] = [];
  let ended = false;

  for (const block of text.split(/\n\s*\n/)) {
    if (ended) break;
    const lines = block.split('\n').map(line => line.trim()).filter(Boolean);
    // PDF は一定の幅で折り返されるため、ほぼ最大幅まで埋まった行だけを「途中で折り返された行」とみなす
    const wrapWidth = Math.max(...lines.map(line => line.length), 0) * 0.75;
    let current = '';
    let previousLine = '';

    for (const line of lines) {
      // 冒頭以外で会社概要・問い合わせ先などが始まったら、そこで本文を打ち切る
      if (SECTION_END.test(line) && paragraphs.length + (current ? 1 : 0) >= 1) {
        ended = true;
        break;
      }
      const wrapped = previousLine.length >= wrapWidth && !/[。！？.!?」』]$/.test(previousLine);
      if (!current || BULLET.test(line) || !wrapped) {
        if (current) paragraphs.push(current);
        current = line;
      } else {
        // 行の途中で改行されている場合はつなげる（日本語は空白なし、英語は空白あり）
        current += CJK.test(current.slice(-1)) && CJK.test(line[0]) ? line : ` ${line}`;
      }
      previousLine = line;
    }
    if (current) paragraphs.push(current);
  }

  return paragraphs.map(p => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

function splitSentences(paragraph: string): string[] {
  const cjkRatio = (paragraph.match(CJK_RUN) ?? []).join('').length / Math.max(paragraph.length, 1);
  const parts = cjkRatio > 0.3
    ? paragraph.split(/(?<=[。！？])(?![」』）)])/)
    // 英語は「U.S.」「Inc.」などで誤って区切らないよう、句点の後に空白と大文字が続く箇所で区切る
    : paragraph.split(/(?<=[a-z0-9)"”][.!?])\s+(?=[A-Z"“(])/);
  return parts.map(s => s.trim()).filter(Boolean);
}

/** 文を比較するための語: 日本語は2文字ずつの組（バイグラム）、英語は単語 */
function extractTerms(text: string): Map<string, number> {
  const terms = new Map<string, number>();
  const add = (term: string) => terms.set(term, (terms.get(term) ?? 0) + 1);

  for (const run of text.match(CJK_RUN) ?? []) {
    if (run.length === 1) add(run);
    for (let i = 0; i < run.length - 1; i++) add(run.slice(i, i + 2));
  }
  for (const word of text.toLowerCase().match(/[a-z][a-z0-9'-]{2,}/g) ?? []) {
    if (!EN_STOPWORDS.has(word)) add(word);
  }
  return terms;
}

function cosine(a: Map<string, number>, b: Map<string, number>, idf: Map<string, number>): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const [term, count] of a) {
    const weight = count * (idf.get(term) ?? 1);
    normA += weight * weight;
    const other = b.get(term);
    if (other) dot += weight * other * (idf.get(term) ?? 1);
  }
  for (const [term, count] of b) {
    const weight = count * (idf.get(term) ?? 1);
    normB += weight * weight;
  }
  return normA && normB ? dot / Math.sqrt(normA * normB) : 0;
}

/** 文同士の類似度をもとに、多くの文と内容を共有する「中心的な文」を高く評価する */
function textRank(sentences: Sentence[], idf: Map<string, number>): number[] {
  const n = sentences.length;
  const sim = sentences.map((a, i) => sentences.map((b, j) => (i === j ? 0 : cosine(a.terms, b.terms, idf))));
  const rowSums = sim.map(row => row.reduce((sum, value) => sum + value, 0));
  let scores = new Array<number>(n).fill(1 / n);

  for (let iteration = 0; iteration < 30; iteration++) {
    scores = scores.map((_, i) =>
      0.15 / n + 0.85 * sim.reduce((sum, row, j) => (rowSums[j] ? sum + (row[i] / rowSums[j]) * scores[j] : sum), 0)
    );
  }
  const max = Math.max(...scores, 1e-9);
  return scores.map(score => score / max);
}

function overlapWithTitle(terms: Map<string, number>, titleTerms: Map<string, number>): number {
  if (!titleTerms.size) return 0;
  let shared = 0;
  for (const term of titleTerms.keys()) if (terms.has(term)) shared++;
  return shared / titleTerms.size;
}

function similar(a: Sentence, b: Sentence): boolean {
  let shared = 0;
  for (const term of a.terms.keys()) if (b.terms.has(term)) shared++;
  return shared / Math.max(1, Math.min(a.terms.size, b.terms.size)) > 0.6;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trim()}…` : text;
}

export function summarizeExtractively(title: string, text: string): SummaryDraft {
  const sentences: Sentence[] = [];
  for (const paragraph of cleanArticleText(text)) {
    const isBullet = BULLET.test(paragraph);
    for (const raw of splitSentences(paragraph)) {
      const cleaned = raw.replace(WIRE_DATELINE, '').replace(COMPANY_DETAILS, '').replace(BULLET, '').replace(/\s+/g, ' ').trim();
      const isCjk = CJK.test(cleaned);
      const minLength = isCjk ? 12 : 40;
      if (cleaned.length < minLength || cleaned.length > 500 || NOISE.test(cleaned) || BOILERPLATE_SENTENCE.test(cleaned)) continue;
      // 見出しと同じ文は要約として意味がないため除く
      if (cleaned.replace(/\s/g, '') === title.replace(/\s/g, '')) continue;
      sentences.push({ text: cleaned, index: sentences.length, isBullet, terms: extractTerms(cleaned) });
    }
  }

  if (sentences.length === 0) {
    return { headlineJa: title, summary: '', keyPoints: [], insufficient: true };
  }

  const documentFrequency = new Map<string, number>();
  sentences.forEach(s => s.terms.forEach((_, term) => documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1)));
  const idf = new Map([...documentFrequency].map(([term, df]) => [term, Math.log(1 + sentences.length / df)]));

  const centrality = textRank(sentences, idf);
  const titleTerms = extractTerms(title);
  const scored = sentences.map((sentence, i) => {
    // ニュースリリースは冒頭の文に要旨が書かれることが多いため、前の方の文を優遇する
    const position = i === 0 ? 1 : 0.6 / (1 + i * 0.5);
    const lengthPenalty = sentence.text.length > 220 ? 0.8 : 1;
    const score = (0.4 * centrality[i] + 0.35 * overlapWithTitle(sentence.terms, titleTerms) + 0.25 * position) * lengthPenalty;
    return { sentence, score };
  });

  const ranked = [...scored].sort((a, b) => b.score - a.score);
  const isCjkDocument = CJK.test(title) || CJK.test(sentences[0].text);
  const targetLength = isCjkDocument ? 130 : 300;

  const chosen: Sentence[] = [];
  let length = 0;
  for (const { sentence } of ranked) {
    if (chosen.length >= 3 || length >= targetLength) break;
    if (sentence.isBullet || chosen.some(other => similar(other, sentence))) continue;
    if (chosen.length > 0 && length + sentence.text.length > targetLength * 1.8) continue;
    chosen.push(sentence);
    length += sentence.text.length;
  }
  chosen.sort((a, b) => a.index - b.index);

  // 要点: 要約に含まれない文のうち、数値・日付・金額などの具体的な事実を含むもの
  const keyPoints = ranked
    .map(({ sentence, score }) => ({ sentence, score: score * (FACT.test(sentence.text) ? 1.5 : 0.6) * (sentence.isBullet ? 1.2 : 1) }))
    .sort((a, b) => b.score - a.score)
    .filter(({ sentence }) => !chosen.includes(sentence) && FACT.test(sentence.text))
    .map(({ sentence }) => sentence)
    .filter((sentence, i, list) => !chosen.some(c => similar(c, sentence)) && !list.slice(0, i).some(p => similar(p, sentence)))
    .slice(0, 3)
    .sort((a, b) => a.index - b.index)
    .map(sentence => truncate(sentence.text.replace(LEADING_CONNECTIVE, ''), 120));

  // 抜き出した文が見出しとほとんど関係ない場合（記事ではなく一覧ページにリンクしている等）は、内容不足として扱う
  const relevance = Math.max(...chosen.map(sentence => overlapWithTitle(sentence.terms, titleTerms)), 0);
  const unrelated = titleTerms.size >= 4 && relevance < 0.15;

  return {
    headlineJa: title,
    summary: unrelated ? '' : chosen.map(sentence => sentence.text).join(isCjkDocument ? '' : ' '),
    keyPoints: unrelated ? [] : keyPoints,
    insufficient: unrelated || sentences.length < 2
  };
}

export const extractiveSummarizer: Summarizer = {
  id: 'extractive',
  method: 'extractive',
  cheap: true,
  async summarize(input: SummaryInput): Promise<SummaryDraft> {
    return summarizeExtractively(input.item.title, input.text || input.item.summary);
  }
};
