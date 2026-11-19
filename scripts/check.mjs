#!/usr/bin/env node
// 1단계 · 기술 점검
// 실제 주소를 받아 검색엔진과 AI가 「들어와서 읽을 수 있는지」 16가지를 본다.
// 사용: node check.mjs <주소> [--out seo-check] [--pages 5]
import path from "node:path";
import {
  BOTS, BROWSER_UA, parseArgs, normalizeUrl, previewKind, fetchPage, title, metaContent, findTags,
  visibleText, headings, jsonLdTypes, links, parseRobots, robotsAllows, sitemapLocs, writeJson, MARK,
} from "./lib.mjs";

const args = parseArgs(process.argv.slice(2));
const start = normalizeUrl(args._[0]);
if (!start) {
  console.error("사용법: node check.mjs <사이트 주소> [--out seo-check] [--pages 5]");
  process.exit(1);
}
const outDir = path.resolve(args.out || "seo-check");
const maxPages = Math.max(1, Math.min(20, Number(args.pages) || 5));

const checks = [];
// grade: pass ○ · warn △ · fail ✕ · todo ☐(할 일) · info ·(참고)
function add(id, group, name, grade, detail, why) {
  checks.push({ id, group, name, grade, detail, why });
}

const say = (s) => process.stdout.write(s + "\n");
say(`\n🔎 점검 시작: ${start}`);

// ── 0. 주소 ──
const preview = previewKind(start);
const home = await fetchPage(start);
if (!home.ok) {
  console.error(`✕ 주소를 열 수 없어요: ${home.error}`);
  writeJson(path.join(outDir, "check.json"), { url: start, checkedAt: new Date().toISOString(), error: home.error, checks: [] });
  process.exit(2);
}
const finalUrl = home.url;
const origin = new URL(finalUrl).origin;
const html = home.body;

// ── 1. 정상 열림 ──
{
  const st = home.status;
  const hopText = home.hops.length ? ` (넘겨주기 ${home.hops.length}번: ${home.hops.map((h) => h.status).join("→")})` : "";
  const grade = st === 200 ? (home.hops.length > 1 ? "warn" : "pass") : "fail";
  add("open", "들어올 수 있나", "정상 열림", grade, `응답 ${st}${hopText} · 최종 주소 ${finalUrl}`,
    "주소를 열었을 때 200(정상)이 나와야 검색엔진이 페이지를 가져가요.");
}

// ── 2. 검색 금지 표시 ──
{
  const robotsMeta = [metaContent(html, "robots"), metaContent(html, "googlebot")].filter(Boolean).join(", ");
  const xrt = home.headers["x-robots-tag"] || "";
  const blocked = /noindex/i.test(robotsMeta) || /noindex/i.test(xrt);
  const where = [robotsMeta && `meta robots: ${robotsMeta}`, xrt && `X-Robots-Tag: ${xrt}`].filter(Boolean).join(" · ") || "검색 금지 표시 없음";
  add("noindex", "들어올 수 있나", "「검색 금지」 표시 없음", blocked ? "fail" : "pass",
    blocked && preview ? `${where} (${preview}라서 붙은 표시예요. 진짜 주소로 다시 점검하세요)` : where,
    "noindex가 있으면 검색엔진이 이 페이지를 검색 결과에 넣지 않아요.");
}

// ── 3. robots.txt ──
const robotsRes = await fetchPage(origin + "/robots.txt");
const robotsText = robotsRes.ok && robotsRes.status === 200 && !/<html/i.test(robotsRes.body) ? robotsRes.body : "";
const robots = parseRobots(robotsText);
{
  if (!robotsText) {
    add("robots", "들어올 수 있나", "robots.txt", "warn", `없음 (응답 ${robotsRes.status ?? robotsRes.error}) · 없어도 다 허용으로 보지만, 사이트맵 위치를 알려 주려면 있는 게 좋아요`,
      "robots.txt는 봇에게 「어디까지 들어와도 되는지」 알려 주는 안내문이에요.");
  } else {
    const all = robotsAllows(robots, "*", new URL(finalUrl).pathname);
    add("robots", "들어올 수 있나", "robots.txt", all.allowed ? "pass" : "fail",
      all.allowed ? `있음 · 홈 허용 (${all.by})` : `모든 봇이 막혀 있어요 (${all.by})`,
      "robots.txt는 봇에게 「어디까지 들어와도 되는지」 알려 주는 안내문이에요.");
  }
}

// ── 4. AI · 검색 봇 이름으로 받아 보기 ──
const normalTextLen = visibleText(html).length;
{
  const rows = [];
  let worst = "pass";
  const pathname = new URL(finalUrl).pathname;
  for (const bot of BOTS) {
    const rule = robotsAllows(robots, bot.token, pathname);
    const r = await fetchPage(finalUrl, { ua: bot.ua });
    const len = r.ok ? visibleText(r.body).length : 0;
    let g = "pass";
    let note = "";
    if (!rule.allowed) { g = "fail"; note = `robots.txt에서 막힘(${rule.by})`; }
    else if (!r.ok || r.status >= 400) { g = "fail"; note = `응답 ${r.status ?? r.error}`; }
    else if (normalTextLen > 200 && len < normalTextLen * 0.5) { g = "warn"; note = `글자가 덜 보임(${len}자 / 보통 ${normalTextLen}자)`; }
    else note = `응답 ${r.status} · 글자 ${len}자`;
    if (g === "fail") worst = "fail";
    else if (g === "warn" && worst === "pass") worst = "warn";
    rows.push(`${MARK[g]} ${bot.label}(${bot.token}): ${note}`);
  }
  add("bots", "들어올 수 있나", "검색 · AI 봇 이름으로 받아 보기", worst, rows.join("\n"),
    "ChatGPT · Claude · Perplexity · 네이버 봇이 실제로 들어와 글자를 가져갈 수 있는지 봐요. 일부만 막힌 경우도 있어요.");
}

// ── 5. sitemap ──
let sitemapUrls = [];
{
  const candidates = [...new Set([...robots.sitemaps, origin + "/sitemap.xml", origin + "/sitemap-index.xml", origin + "/sitemap_index.xml"])];
  let found = null;
  for (const c of candidates) {
    const r = await fetchPage(c);
    if (r.ok && r.status === 200 && /<(urlset|sitemapindex)\b/i.test(r.body)) { found = { url: r.url, body: r.body }; break; }
  }
  if (!found) {
    add("sitemap", "길 안내가 있나", "sitemap.xml", "fail", "사이트맵을 찾지 못했어요 (/sitemap.xml · robots.txt의 Sitemap 줄)",
      "사이트맵은 「우리 사이트에 이런 페이지들이 있어요」라는 목록이에요. 등록 단계에서 검색엔진에 이걸 건네요.");
  } else {
    let locs = sitemapLocs(found.body);
    if (/<sitemapindex\b/i.test(found.body)) {
      const children = locs.slice(0, 5);
      locs = [];
      for (const c of children) {
        const r = await fetchPage(c);
        if (r.ok) locs.push(...sitemapLocs(r.body));
      }
    }
    const host = new URL(finalUrl).hostname.replace(/^www\./, "");
    const other = locs.filter((l) => { try { return new URL(l).hostname.replace(/^www\./, "") !== host; } catch { return true; } });
    sitemapUrls = locs.filter((l) => !other.includes(l));
    const inRobots = robots.sitemaps.length > 0;
    let grade = "pass";
    const notes = [`${found.url} · 주소 ${locs.length}개`];
    if (!locs.length) { grade = "fail"; notes.push("안에 주소가 없어요"); }
    if (other.length) { grade = "fail"; notes.push(`다른 주소가 섞여 있어요(예: ${other[0]}) · 미리보기 주소나 예전 도메인이면 고쳐야 해요`); }
    if (grade === "pass" && !inRobots) { grade = "warn"; notes.push("robots.txt에 Sitemap 줄이 없어요"); }
    add("sitemap", "길 안내가 있나", "sitemap.xml", grade, notes.join(" · "),
      "사이트맵은 「우리 사이트에 이런 페이지들이 있어요」라는 목록이에요. 등록 단계에서 검색엔진에 이걸 건네요.");
  }
}

// ── 점검할 페이지 고르기: 홈 + 사이트맵(없으면 홈의 안쪽 링크) ──
const homeLinks = links(html, finalUrl);
const pool = sitemapUrls.length ? sitemapUrls : homeLinks.filter((l) => l.internal && !l.hashRoute).map((l) => l.url.split("#")[0]);
const pageUrls = [finalUrl, ...[...new Set(pool)].filter((u) => u.replace(/\/$/, "") !== finalUrl.replace(/\/$/, ""))].slice(0, maxPages);
const pages = [];
for (const u of pageUrls) {
  const r = u === finalUrl ? home : await fetchPage(u);
  if (!r.ok) { pages.push({ url: u, error: r.error }); continue; }
  // 넘겨주기 끝에 같은 페이지로 오면 한 번만 센다
  if (pages.some((p) => p.url && p.url.replace(/\/$/, "") === r.url.replace(/\/$/, ""))) continue;
  const h = r.body;
  pages.push({
    url: r.url,
    status: r.status,
    title: title(h),
    description: metaContent(h, "description"),
    h1: headings(h, 1),
    canonical: (findTags(h, "link").find((a) => (a.rel || "").toLowerCase().split(/\s+/).includes("canonical")) || {}).href || null,
    textLength: visibleText(h).length,
    noindex: /noindex/i.test(metaContent(h, "robots") || "") || /noindex/i.test(r.headers["x-robots-tag"] || ""),
  });
}
const okPages = pages.filter((p) => !p.error && p.status === 200);

// ── 6. 메뉴가 진짜 링크 ──
{
  const internal = homeLinks.filter((l) => l.internal && !l.hashRoute && new URL(l.url).pathname !== new URL(finalUrl).pathname);
  const hashRoutes = homeLinks.filter((l) => l.hashRoute);
  const onclick = (html.match(/<(button|div|span)\b[^>]*onclick=/gi) || []).length;
  let grade = "pass";
  let detail = `다른 페이지로 가는 링크 ${new Set(internal.map((l) => l.url)).size}개`;
  if (hashRoutes.length) { grade = "warn"; detail += ` · #/ 형태 주소 ${hashRoutes.length}개(검색엔진은 # 뒤를 다른 페이지로 보지 않아요)`; }
  if (!internal.length && okPages.length <= 1 && sitemapUrls.length > 1) { grade = "fail"; detail += " · 사이트맵엔 여러 페이지가 있는데 홈에서 가는 링크가 없어요"; }
  if (!internal.length && normalTextLen < 80) { grade = "warn"; detail += " · 화면이 자바스크립트로 그려져 링크를 확인하지 못했어요"; }
  if (onclick) detail += ` · 클릭으로만 이동하는 요소 ${onclick}개`;
  add("links", "길 안내가 있나", "메뉴가 진짜 링크(<a href>)", grade, detail,
    "봇은 버튼을 누르지 못하고 <a href> 링크만 따라가요. 링크가 없으면 다른 페이지를 못 찾아요.");
}

// ── 7. 대표 주소(canonical) ──
{
  const rows = [];
  let grade = "pass";
  for (const p of okPages) {
    if (!p.canonical) { rows.push(`${MARK.warn} ${p.url}: 없음`); if (grade === "pass") grade = "warn"; continue; }
    let cu;
    try { cu = new URL(p.canonical, p.url); } catch { rows.push(`${MARK.fail} ${p.url}: 잘못된 주소 ${p.canonical}`); grade = "fail"; continue; }
    const sameHost = cu.hostname.replace(/^www\./, "") === new URL(p.url).hostname.replace(/^www\./, "");
    const pv = previewKind(cu.toString());
    if (!sameHost || pv) { rows.push(`${MARK.fail} ${p.url}: ${cu} (${pv || "다른 주소"}를 가리켜요)`); grade = "fail"; }
    else rows.push(`${MARK.pass} ${p.url}: ${cu}`);
  }
  add("canonical", "길 안내가 있나", "대표 주소(canonical)", okPages.length ? grade : "warn", rows.join("\n") || "확인할 페이지가 없어요",
    "「이 페이지의 진짜 주소는 여기예요」라는 표시예요. 미리보기 주소를 가리키면 검색엔진이 엉뚱한 주소를 기억해요.");
}

// ── 8. 없는 주소는 404 ──
{
  const r = await fetchPage(`${origin}/this-page-does-not-exist-${Date.now().toString(36)}`);
  const st = r.status ?? r.error;
  add("notfound", "길 안내가 있나", "없는 주소는 404", st === 404 || st === 410 ? "pass" : "fail",
    st === 404 || st === 410 ? `응답 ${st}` : `응답 ${st} · 없는 주소도 정상 페이지처럼 열려요(React 같은 SPA에서 흔해요)`,
    "없는 주소가 200으로 열리면 검색엔진이 빈 페이지를 잔뜩 모아 사이트 품질을 낮게 볼 수 있어요.");
}

// ── 9. 자바스크립트 없이 보이는 글자 ──
{
  const rows = okPages.map((p) => `${p.textLength < 80 ? MARK.fail : p.textLength < 300 ? MARK.warn : MARK.pass} ${p.url}: ${p.textLength}자`);
  const min = Math.min(...okPages.map((p) => p.textLength));
  const grade = !okPages.length ? "warn" : min < 80 ? "fail" : min < 300 ? "warn" : "pass";
  add("text", "글자로 읽히나", "자바스크립트 없이 보이는 글자", grade, rows.join("\n"),
    "대부분의 AI 봇은 자바스크립트를 실행하지 않고 처음 받은 HTML의 글자만 읽어요. 여기가 비어 있으면 AI 눈에는 빈 사이트예요.");
}

// ── 10. H1 ──
{
  const rows = okPages.map((p) => `${p.h1.length === 1 ? MARK.pass : p.h1.length ? MARK.warn : MARK.fail} ${p.url}: ${p.h1.length}개${p.h1[0] ? ` 「${p.h1[0].slice(0, 60)}」` : ""}`);
  const counts = okPages.map((p) => p.h1.length);
  const grade = counts.some((c) => c === 0) ? "fail" : counts.some((c) => c > 1) ? "warn" : "pass";
  add("h1", "글자로 읽히나", "H1(가장 큰 제목) 하나", okPages.length ? grade : "warn", rows.join("\n"),
    "H1은 「이 페이지는 무엇에 대한 것인가」를 알려 주는 대표 제목이에요. 페이지마다 하나가 좋아요.");
}

// ── 11. lang · viewport ──
{
  const htmlTag = findTags(html, "html")[0] || {};
  const lang = htmlTag.lang || "";
  const viewport = metaContent(html, "viewport");
  const hangul = (visibleText(html).match(/[가-힣]/g) || []).length;
  let grade = "pass";
  const notes = [];
  if (!lang) { grade = "fail"; notes.push("lang 없음"); }
  else if (hangul > 30 && !/^ko/i.test(lang)) { grade = "warn"; notes.push(`lang="${lang}"인데 한국어 사이트예요 → lang="ko"`); }
  else notes.push(`lang="${lang}"`);
  if (!viewport) { grade = "fail"; notes.push("viewport 없음(휴대폰 화면 설정)"); }
  else notes.push("viewport 있음");
  add("lang", "글자로 읽히나", "언어 표시(lang) · 휴대폰 화면 설정", grade, notes.join(" · "),
    "언어 표시가 맞아야 한국어 검색에 맞게 다뤄요. viewport가 없으면 휴대폰에서 깨져 보여 점수가 낮아져요.");
}

// ── 12. 이미지 설명(alt) ──
{
  const imgs = findTags(html, "img");
  const missing = imgs.filter((a) => a.alt === undefined);
  const ratio = imgs.length ? missing.length / imgs.length : 0;
  const grade = !imgs.length ? "pass" : ratio === 0 ? "pass" : ratio > 0.5 ? "fail" : "warn";
  add("alt", "글자로 읽히나", "이미지 설명(alt)", grade,
    imgs.length ? `홈 이미지 ${imgs.length}개 중 alt 없는 것 ${missing.length}개${missing[0] ? ` (예: ${missing[0].src?.slice(0, 80)})` : ""}` : "홈 HTML에 이미지가 없어요",
    "봇은 그림을 못 봐요. alt에 적은 설명으로 「무슨 이미지인지」 알아요. 꾸밈용 그림은 alt=\"\"로 비워 두면 돼요.");
}

// ── 13. 제목 · 설명 ──
{
  const rows = [];
  let grade = "pass";
  const titles = okPages.map((p) => p.title || "");
  const descs = okPages.map((p) => p.description || "");
  for (const p of okPages) {
    const issues = [];
    if (!p.title) issues.push("제목 없음");
    else if (p.title.length > 60) issues.push(`제목 김(${p.title.length}자)`);
    if (!p.description) issues.push("설명 없음");
    else if (p.description.length < 20) issues.push("설명 너무 짧음");
    if (p.title && titles.filter((t) => t === p.title).length > 1) issues.push("다른 페이지와 제목이 같음");
    if (p.description && descs.filter((d) => d === p.description).length > 1) issues.push("다른 페이지와 설명이 같음");
    const g = issues.some((i) => /없음/.test(i)) ? "fail" : issues.length ? "warn" : "pass";
    if (g === "fail") grade = "fail"; else if (g === "warn" && grade === "pass") grade = "warn";
    rows.push(`${MARK[g]} ${p.url}\n   제목: ${p.title || "-"}\n   설명: ${p.description || "-"}${issues.length ? `\n   → ${issues.join(", ")}` : ""}`);
  }
  add("meta", "소개가 정확한가", "페이지별 제목 · 설명", okPages.length ? grade : "warn", rows.join("\n"),
    "검색 결과에 파란 제목과 그 아래 설명으로 그대로 나와요. 페이지마다 달라야 각각 따로 찾아져요.");
}

// ── 14. 구조화 데이터(JSON-LD) ──
{
  const { types, errors } = jsonLdTypes(html);
  const who = types.filter((t) => /^(Organization|Person|LocalBusiness|ProfessionalService|EducationalOrganization|Store|Restaurant|Corporation|NGO|.*Business)$/.test(t));
  let grade = who.length ? "pass" : types.length ? "warn" : "fail";
  if (errors.length) grade = "fail";
  add("jsonld", "소개가 정확한가", "구조화 데이터(누구의 사이트인지)", grade,
    `${types.length ? `있음: ${[...new Set(types)].join(", ")}` : "없음"}${errors.length ? ` · ${errors.join(", ")}` : ""}${!who.length ? " · 「누구인지」(Organization · Person · LocalBusiness) 표시가 없어요" : ""}`,
    "검색엔진과 AI에게 「이 사이트 주인은 이런 사람/가게예요」를 기계가 읽는 말로 알려 주는 부분이에요.");
}

// ── 15. 공유 카드(OG) · 파비콘 ──
{
  const ogTitle = metaContent(html, "og:title");
  const ogDesc = metaContent(html, "og:description");
  const ogImg = metaContent(html, "og:image");
  const notes = [];
  let grade = "pass";
  if (!ogImg) { grade = "fail"; notes.push("og:image 없음"); }
  else if (!/^https?:\/\//.test(ogImg)) { grade = "warn"; notes.push(`og:image가 상대 주소(${ogImg}) · https://로 시작하는 전체 주소여야 해요`); }
  else notes.push("og:image 있음");
  if (!ogTitle || !ogDesc) { if (grade === "pass") grade = "warn"; notes.push(`${!ogTitle ? "og:title " : ""}${!ogDesc ? "og:description " : ""}없음`.trim()); }
  const icon = findTags(html, "link").find((a) => /(^|\s)(icon|shortcut icon|apple-touch-icon)(\s|$)/i.test(a.rel || ""));
  let fav = !!icon;
  if (!fav) { const r = await fetchPage(origin + "/favicon.ico"); fav = r.ok && r.status === 200; }
  if (!fav) { if (grade === "pass") grade = "warn"; notes.push("파비콘 없음"); } else notes.push("파비콘 있음");
  add("og", "소개가 정확한가", "공유 카드(OG) · 파비콘", grade, notes.join(" · "),
    "카톡 · 스레드에 링크를 붙였을 때 뜨는 카드예요. 검색 결과 옆 작은 아이콘(파비콘)도 여기 포함돼요.");
}

// ── 16. 소유 확인 태그 ──
{
  const google = metaContent(html, "google-site-verification");
  const naver = metaContent(html, "naver-site-verification");
  const bing = metaContent(html, "msvalidate.01");
  const have = [google && "구글", naver && "네이버", bing && "빙"].filter(Boolean);
  add("verify", "소개가 정확한가", "소유 확인 태그", google && naver ? "pass" : "todo",
    have.length ? `있음: ${have.join(" · ")}${!google ? " · 구글 없음" : ""}${!naver ? " · 네이버 없음" : ""}` : "아직 없음 → 4단계(색인 등록)에서 넣어요",
    "「이 사이트 주인이 나예요」를 검색엔진에 증명하는 태그예요. 등록할 때 받아서 넣어요(빙은 구글에서 가져오면 따로 필요 없어요).");
}

// ── 참고: llms.txt ──
{
  const r = await fetchPage(origin + "/llms.txt");
  const has = r.ok && r.status === 200 && !/<html/i.test(r.body);
  add("llms", "참고", "llms.txt", "info", has ? "있음" : "없음 (없어도 괜찮아요)",
    "AI용 안내 파일이에요. 구글은 「따로 필요 없다」고 했고 실제로 읽히는 경우도 드물어서 점수에 넣지 않아요.");
}

// ── 정리 ──
const order = ["open", "noindex", "robots", "bots", "sitemap", "links", "canonical", "notfound", "text", "h1", "lang", "alt", "meta", "jsonld", "og", "verify", "llms"];
checks.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
const scored = checks.filter((c) => ["pass", "warn", "fail"].includes(c.grade));
const summary = {
  pass: scored.filter((c) => c.grade === "pass").length,
  warn: scored.filter((c) => c.grade === "warn").length,
  fail: scored.filter((c) => c.grade === "fail").length,
  todo: checks.filter((c) => c.grade === "todo").length,
  total: scored.length,
};
const result = { url: start, finalUrl, preview, checkedAt: new Date().toISOString(), pagesChecked: pages, summary, checks };
const file = path.join(outDir, "check.json");
writeJson(file, result);

if (preview) say(`\n⚠️  ${preview}예요. 검색엔진은 이 주소를 무시해요. 진짜 주소(프로젝트.vercel.app 또는 내 도메인)로 다시 점검하세요.`);
let group = "";
for (const c of checks) {
  if (c.group !== group) { group = c.group; say(`\n■ ${group}`); }
  say(`${MARK[c.grade]} ${c.name}`);
  for (const line of String(c.detail).split("\n")) say(`    ${line}`);
}
say(`\n결과: ○ ${summary.pass} · △ ${summary.warn} · ✕ ${summary.fail}${summary.todo ? ` · ☐ 할 일 ${summary.todo}` : ""} (점검 페이지 ${okPages.length}개)`);
say(`저장: ${file}`);
