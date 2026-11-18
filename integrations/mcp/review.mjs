import path from 'node:path';
import { readFile, readdir, stat } from 'node:fs/promises';

// The pet's own look at a finished result (#77). When an AI reports `done` with a result path,
// this reads that one file and counts what a person would otherwise find only after opening it:
// slides, blanks that were never filled in, notes to the author left on the page, and parts that
// need the internet. Fixed rules only: no AI call, nothing is run, nothing is changed.
// It does not render the page (no overflow or overlap check) and it does not check facts.
// Counts go to the app; the short samples go back only to the AI that wrote the file.

const MAX_BYTES = 512 * 1024;
const MAX_ENTRIES = 200;
const KINDS = new Map([['.html', 'html'], ['.htm', 'html'], ['.md', 'text'], ['.txt', 'text']]);
const SAMPLE = 30;

const entities = text => text.replace(/&nbsp;/giu, ' ').replace(/&amp;/giu, '&').replace(/&lt;/giu, '<').replace(/&gt;/giu, '>').replace(/&quot;/giu, '"').replace(/&#39;/giu, "'");
/** What a reader sees: scripts, styles, comments and tags removed. */
export const visibleText = html => entities(html.replace(/<!--[\s\S]*?-->/gu, ' ').replace(/<(script|style|template|noscript)\b[\s\S]*?<\/\1\s*>/giu, ' ')
  .replace(/<\/(p|div|section|li|h[1-6]|td|th|tr|article|header|footer|br)\s*>|<br\s*\/?>/giu, '\n').replace(/<[^>]*>/gu, ' '))
  .split('\n').map(line => line.replace(/\s+/gu, ' ').trim()).filter(Boolean).join('\n');

const unique = values => [...new Set(values)];
const short = value => { const text = value.trim(); return [...text].length > SAMPLE ? `${[...text].slice(0, SAMPLE - 1).join('')}…` : text; };

/** Blanks left for someone to fill in: [모집 시작일], ○○동아리, OOO, {{name}}, YYYY-MM-DD, 00월 00일, TBD, lorem ipsum. */
export function findBlanks(text) {
  const found = [];
  // A bracket holding words, not a footnote number, a checkbox or a Markdown link.
  for (const [match, inner] of text.matchAll(/\[([^\[\]\n]{2,30})\](?![(\[:])/gu)) if (/[\p{L}]/u.test(inner) && !/^[xX✓✔ ]$/u.test(inner)) found.push(match);
  for (const [match] of text.matchAll(/\{\{[^{}\n]{1,30}\}\}|[○◯]{2,}[\p{L}]{0,8}|(?<![A-Za-z])O{3,}(?![A-Za-z])|(?<![A-Za-z])X{3,}(?![A-Za-z])|YYYY[-./년 ]?(?:MM)?[-./월 ]?(?:DD)?|0{2}월 ?0{2}일|(?<![A-Za-z])(?:TBD|TODO)(?![A-Za-z])|lorem ipsum/giu)) found.push(match);
  return found;
}

/** Lines that speak to the author instead of the audience, left on the page. */
export function findNotes(text) {
  return text.split('\n').filter(line => [...line].length <= 120
    && /(수정|변경|교체|입력|조정|기입|작성|채워|바꿔|넣어)\s?(해|하여)?\s?(주세요|주십시오|넣으세요|바꾸세요)|여기에 .{0,20}(입력|넣으|작성)|(?:replace|insert|edit|fill in) (?:this|with|your|the)\b/iu.test(line));
}

/** Resources a page loads from the internet in order to look right. */
export function findExternal(html) {
  const hosts = [];
  const add = url => { try { hosts.push(new URL(url).hostname); } catch { /* not an address */ } };
  for (const [tag, name] of html.matchAll(/<(link|script|img|iframe|video|audio|source)\b[^>]*>/giu)) {
    const url = /\b(?:href|src)\s*=\s*["'](https?:\/\/[^"'\s>]+)["']/iu.exec(tag)?.[1];
    // A <link> counts only when the page needs it to look right (a stylesheet, font or icon).
    if (url && (name.toLowerCase() !== 'link' || /\brel\s*=\s*["']?[^"'>]*(?:stylesheet|preload|icon)/iu.test(tag))) add(url);
  }
  for (const [, url] of html.matchAll(/@import\s+(?:url\()?["']?(https?:\/\/[^"')\s]+)/giu)) add(url);
  return hosts;
}

/** Counts and short samples for one result text. `kind` is 'html' or 'text'. */
export function reviewText(content, kind) {
  const text = kind === 'html' ? visibleText(content) : content;
  const blanks = findBlanks(text), notes = findNotes(text), external = kind === 'html' ? findExternal(content) : [];
  const slides = kind === 'html' ? (content.match(/<section\b/giu) ?? []).length : 0;
  return {
    counts: { slides: Math.min(slides < 2 ? 0 : slides, 999), blanks: Math.min(blanks.length, 999), notes: Math.min(notes.length, 999), external: Math.min(unique(external).length, 999) },
    blanks: unique(blanks).slice(0, 8).map(short), notes: unique(notes).slice(0, 5).map(short), external: unique(external).slice(0, 5),
  };
}

const safe = value => typeof value === 'string' && value.length <= 1024 && path.isAbsolute(value) && !/[\u0000-\u001f]/u.test(value) && !value.split(/[\\/]/u).includes('..');

/** The one file to read: the reported file, or the newest readable result in the reported folder (or its `outputs`). */
async function pick(target, io) {
  const info = await io.stat(target);
  if (info.isFile()) return KINDS.has(path.extname(target).toLowerCase()) && info.size <= MAX_BYTES ? target : null;
  if (!info.isDirectory()) return null;
  let best = null;
  for (const folder of [target, path.join(target, 'outputs')]) {
    const names = await io.readdir(folder).catch(() => []);
    for (const name of names.slice(0, MAX_ENTRIES)) {
      if (!KINDS.has(path.extname(name).toLowerCase())) continue;
      const file = path.join(folder, name), entry = await io.stat(file).catch(() => null);
      if (entry?.isFile() && entry.size <= MAX_BYTES && (!best || entry.mtimeMs > best.time)) best = { file, time: entry.mtimeMs };
    }
  }
  return best?.file ?? null;
}

/**
 * Reads the reported result and returns what was found, or null when there is nothing this can
 * read (another file type, too large, missing). It never throws: a check must not get in the way
 * of the report.
 */
export async function reviewResult(resultPath, io = { stat, readdir, readFile }) {
  try {
    if (!safe(resultPath)) return null;
    const file = await pick(resultPath, io);
    if (!file) return null;
    const content = await io.readFile(file, 'utf8');
    if (typeof content !== 'string' || !content.trim() || content.includes('\u0000')) return null;
    return { file: path.basename(file), ...reviewText(content, KINDS.get(path.extname(file).toLowerCase())) };
  } catch { return null; }
}

/** What the AI is told to do with the result, in the same tool answer. */
export const REVIEW_NOTE = '펫이 결과 파일을 직접 읽어 확인한 내용입니다(화면 넘침·겹침과 사실 여부는 확인하지 않음). blanks와 notes는 결과물에 그대로 보입니다. 마지막 답에서 무엇이 비어 있는지 구체적으로 알리고, 사용자가 내용을 주면 채우겠다고 한 줄로 제안하세요. 스스로 고칠 수 있는 것(작성자에게 남긴 안내 문구 등)은 고친 뒤 done을 다시 알리세요. 내용을 지어내 빈칸을 채우지 마세요.';
