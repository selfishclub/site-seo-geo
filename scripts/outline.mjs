#!/usr/bin/env node
// 2단계 · 글 구조 뽑기
// 페이지마다 제목 순서(H1 → H2 → H3)와 각 칸의 첫 문장, 표 · 목록 · FAQ, 글자로 적힌 사실을 뽑는다.
// 판단(추천 구조)은 Claude가 이 결과를 보고 한다. 이 스크립트는 「있는 그대로」만 적는다.
// 사용: node outline.mjs <주소> [--out seo-check] [--pages 5]
import path from "node:path";
import {
  parseArgs, normalizeUrl, fetchPage, title, metaContent, findTags, stripTags, visibleText,
  jsonLdTypes, links, readJson, writeJson,
} from "./lib.mjs";

const args = parseArgs(process.argv.slice(2));
const start = normalizeUrl(args._[0]);
if (!start) {
  console.error("사용법: node outline.mjs <사이트 주소> [--out seo-check] [--pages 5]");
  process.exit(1);
}
const outDir = path.resolve(args.out || "seo-check");
const maxPages = Math.max(1, Math.min(20, Number(args.pages) || 5));
const say = (s) => process.stdout.write(s + "\n");

// 점검할 페이지: check.json이 있으면 같은 페이지, 없으면 홈 + 안쪽 링크
let pageUrls = [];
const prev = readJson(path.join(outDir, "check.json"));
if (prev?.pagesChecked?.length) pageUrls = prev.pagesChecked.filter((p) => !p.error).map((p) => p.url);
if (!pageUrls.length) {
  const home = await fetchPage(start);
  if (!home.ok) { console.error(`✕ 주소를 열 수 없어요: ${home.error}`); process.exit(2); }
  const inner = links(home.body, home.url).filter((l) => l.internal && !l.hashRoute).map((l) => l.url.split("#")[0]);
  pageUrls = [home.url, ...new Set(inner)].filter((u, i, all) => all.findIndex((x) => x.replace(/\/$/, "") === u.replace(/\/$/, "")) === i);
}
pageUrls = pageUrls.slice(0, maxPages);

function firstSentences(text, max = 160) {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return "";
  const parts = t.match(/[^.!?。]+[.!?。]?/g) || [t];
  let out = "";
  for (const p of parts) {
    if ((out + p).length > max && out) break;
    out += p;
    if (out.length > 60) break;
  }
  return out.length > max ? out.slice(0, max) + "…" : out.trim();
}

function cleanBody(html) {
  const body = (html.match(/<body\b[^>]*>([\s\S]*)<\/body>/i) || [, html])[1];
  return body
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, " ")
    .replace(/<template\b[\s\S]*?<\/template>/gi, " ");
}

// 제목 태그로 글을 칸으로 나눈다
function sections(html) {
  const body = cleanBody(html);
  const re = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  const out = [];
  let last = 0;
  let before = "";
  let m;
  const marks = [];
  while ((m = re.exec(body))) marks.push({ level: +m[1], text: stripTags(m[2]), start: m.index, end: re.lastIndex });
  if (marks.length) before = stripTags(body.slice(0, marks[0].start));
  marks.forEach((h, i) => {
    const seg = body.slice(h.end, marks[i + 1] ? marks[i + 1].start : body.length);
    const text = stripTags(seg);
    out.push({ level: h.level, text: h.text, first: firstSentences(text), chars: text.length, question: /[?？]\s*$/.test(h.text) });
    last = h.end;
  });
  return { before: firstSentences(before, 200), list: out };
}

function count(re, s) { return (s.match(re) || []).length; }

function facts(text) {
  const pick = (re) => [...new Set(text.match(re) || [])].slice(0, 3);
  return {
    phone: pick(/0\d{1,2}[-.\s)]\d{3,4}[-.\s]\d{4}|1[5-9]\d{2}-\d{4}/g),
    email: pick(/[\w.+-]+@[\w-]+\.[\w.]+/g),
    price: pick(/\d[\d,]*\s*(?:원|만\s?원)|₩\s?\d[\d,]*/g),
    address: pick(/(?:[가-힣]+(?:특별시|광역시|시|도)\s)?[가-힣]+(?:구|군)\s[가-힣0-9]+(?:로|길|동)(?:\s?\d+(?:-\d+)?)?/g),
    hours: pick(/\d{1,2}:\d{2}\s*[~\-–]\s*\d{1,2}:\d{2}|(?:영업|운영|상담)\s?시간[^.。]{0,20}/g),
  };
}

const pages = [];
for (const url of pageUrls) {
  const r = await fetchPage(url);
  if (!r.ok || r.status !== 200) { pages.push({ url, error: r.error || `응답 ${r.status}` }); continue; }
  const h = r.body;
  const body = cleanBody(h);
  const text = visibleText(h);
  const sec = sections(h);
  const ld = jsonLdTypes(h);
  const allLinks = links(h, r.url);
  const timeTags = findTags(h, "time").map((a) => a.datetime).filter(Boolean);
  const dateText = [...new Set(text.match(/20\d{2}\s?[.\-/년]\s?\d{1,2}\s?[.\-/월]\s?\d{1,2}\s?일?/g) || [])].slice(0, 3);
  const ldDates = [...h.matchAll(/"date(?:Published|Modified)"\s*:\s*"([^"]+)"/g)].map((m) => m[1]);
  const imgs = findTags(h, "img");
  pages.push({
    url: r.url,
    title: title(h),
    description: metaContent(h, "description"),
    textLength: text.length,
    jsOnly: text.length < 80,
    firstScreen: firstSentences(text, 200),
    beforeFirstHeading: sec.before,
    headings: sec.list,
    blocks: {
      tables: count(/<table\b/gi, body),
      orderedLists: count(/<ol\b/gi, body),
      lists: count(/<ul\b/gi, body),
      details: count(/<details\b/gi, body),
      questionHeadings: sec.list.filter((s) => s.question).length,
      faqSchema: ld.types.includes("FAQPage"),
    },
    facts: facts(text),
    freshness: { timeTags: timeTags.slice(0, 3), dateText, jsonLd: ldDates.slice(0, 3) },
    author: metaContent(h, "author") || (h.match(/"author"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"/) || [])[1] || null,
    evidence: {
      numbers: count(/\d[\d,.]*\s*(?:%|명|개|회|건|년|배|점|시간|분)/g, text),
      externalLinks: allLinks.filter((l) => !l.internal && /^https?:/.test(l.url)).length,
      quotes: count(/<blockquote\b|<q\b/gi, body),
    },
    images: { total: imgs.length, withAlt: imgs.filter((a) => a.alt).length, samples: imgs.slice(0, 5).map((a) => ({ src: (a.src || "").slice(0, 120), alt: a.alt ?? null })) },
    jsonLd: [...new Set(ld.types)],
  });
}

const file = path.join(outDir, "outline.json");
writeJson(file, { url: start, extractedAt: new Date().toISOString(), pages });

// 사람이 읽기 좋게 출력
for (const p of pages) {
  say(`\n━━ ${p.url}`);
  if (p.error) { say(`  ✕ ${p.error}`); continue; }
  if (p.jsOnly) say("  ⚠️ 자바스크립트 없이 보이는 글자가 거의 없어요. 코드 폴더의 화면 파일을 직접 읽어 구조를 봐야 해요.");
  say(`  제목: ${p.title || "-"}`);
  say(`  첫 화면: ${p.firstScreen || "-"}`);
  for (const s of p.headings) say(`  ${"  ".repeat(s.level - 1)}H${s.level} ${s.text}${s.first ? `\n  ${"  ".repeat(s.level)}└ ${s.first}` : ""}`);
  const b = p.blocks;
  say(`  블록: 표 ${b.tables} · 번호목록 ${b.orderedLists} · 목록 ${b.lists} · 질문형 제목 ${b.questionHeadings} · FAQ 구조화 ${b.faqSchema ? "있음" : "없음"}`);
  const f = p.facts;
  say(`  글자로 적힌 사실: 전화 ${f.phone.length ? f.phone.join(", ") : "없음"} · 이메일 ${f.email.length ? f.email.join(", ") : "없음"} · 가격 ${f.price.length ? f.price.join(", ") : "없음"} · 주소 ${f.address.length ? f.address.join(", ") : "없음"} · 시간 ${f.hours.length ? f.hours.join(", ") : "없음"}`);
  say(`  날짜 표시: ${[...p.freshness.timeTags, ...p.freshness.dateText, ...p.freshness.jsonLd].join(", ") || "없음"} · 쓴 사람: ${p.author || "없음"}`);
  say(`  근거: 숫자 ${p.evidence.numbers}개 · 바깥 링크 ${p.evidence.externalLinks}개 · 인용 ${p.evidence.quotes}개 · 이미지 ${p.images.total}개(alt ${p.images.withAlt})`);
}
say(`\n저장: ${file}`);
