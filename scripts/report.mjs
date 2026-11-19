#!/usr/bin/env node
// 결과 리포트(HTML 한 장)
// seo-check/ 안의 check.json · outline.json · review.json · register.json · measure.json 을 모아
// seo-check/report.html 로 만든다. 없는 파일은 그 탭을 「아직」으로 보여 준다.
// 사용: node report.mjs [--out seo-check] [--open]
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { parseArgs, readJson, MARK } from "./lib.mjs";

const args = parseArgs(process.argv.slice(2));
const outDir = path.resolve(args.out || "seo-check");
const check = readJson(path.join(outDir, "check.json"));
const outline = readJson(path.join(outDir, "outline.json"));
const review = readJson(path.join(outDir, "review.json"));
const register = readJson(path.join(outDir, "register.json"));
const measure = readJson(path.join(outDir, "measure.json"));

if (!check && !outline) {
  console.error("seo-check/check.json 이 없어요. 먼저 check.mjs 를 돌려 주세요.");
  process.exit(1);
}

const esc = (s = "") => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const GRADE_CLASS = { pass: "pass", warn: "warn", fail: "fail", todo: "todo", info: "info", done: "pass", doing: "warn", skip: "info" };
const badge = (g) => `<span class="mark ${GRADE_CLASS[g] || "info"}">${MARK[g] || { done: "✓", doing: "…", skip: "–" }[g] || "·"}</span>`;

// ── 탭 1 · 기술 점검 ──
function techTab() {
  if (!check) return `<p class="empty">아직 기술 점검을 하지 않았어요. 「내 사이트 점검해 줘」라고 해 보세요.</p>`;
  const s = check.summary || {};
  let html = "";
  if (check.preview) html += `<div class="alert">⚠️ ${esc(check.preview)}예요. 검색엔진은 이 주소를 무시해요. 진짜 주소로 다시 점검하세요.</div>`;
  html += `<div class="score"><div><b class="pass">${s.pass ?? 0}</b><span>○ 좋아요</span></div><div><b class="warn">${s.warn ?? 0}</b><span>△ 고치면 좋아요</span></div><div><b class="fail">${s.fail ?? 0}</b><span>✕ 꼭 고쳐요</span></div>${s.todo ? `<div><b class="todo">${s.todo}</b><span>☐ 등록 때 할 일</span></div>` : ""}</div>`;
  let group = "";
  for (const c of check.checks || []) {
    if (c.group !== group) {
      if (group) html += `</div>`;
      group = c.group;
      html += `<h3>${esc(group)}</h3><div class="cards">`;
    }
    html += `<details class="card ${GRADE_CLASS[c.grade]}" ${c.grade === "fail" ? "open" : ""}><summary>${badge(c.grade)}<span class="name">${esc(c.name)}</span></summary><p class="why">왜? ${esc(c.why)}</p><pre>${esc(c.detail)}</pre></details>`;
  }
  if (group) html += `</div>`;
  html += `<p class="meta">점검: ${esc(check.finalUrl || check.url)} · ${esc(new Date(check.checkedAt).toLocaleString("ko-KR"))}</p>`;
  return html;
}

// ── 탭 2 · 글 구조 ──
function structureTab() {
  if (!outline) return `<p class="empty">아직 글 구조를 뽑지 않았어요.</p>`;
  let html = "";
  if (review?.summary) html += `<div class="note">${esc(review.summary)}</div>`;
  for (const p of outline.pages || []) {
    if (p.error) { html += `<h3>${esc(p.url)}</h3><p class="empty">${esc(p.error)}</p>`; continue; }
    const r = (review?.pages || []).find((x) => x.url && p.url && x.url.replace(/\/$/, "") === p.url.replace(/\/$/, ""));
    html += `<h3>${esc(p.url)}</h3>`;
    if (p.jsOnly) html += `<div class="alert">자바스크립트 없이 보이는 글자가 거의 없어요. AI 봇 눈에는 이 페이지가 비어 보여요.</div>`;
    const now = (p.headings || []).map((h) => `<li class="l${h.level}"><b>H${h.level}</b> ${esc(h.text)}${h.first ? `<small>${esc(h.first)}</small>` : ""}</li>`).join("");
    const rec = (r?.recommended || []).map((h) => `<li class="l${h.level || 2}"><b>H${h.level || 2}</b> ${esc(h.text)}${h.note ? `<small class="hint">← ${esc(h.note)}</small>` : ""}</li>`).join("");
    html += `<div class="compare"><div><h4>지금</h4><ul class="tree">${now || "<li>제목 태그가 없어요</li>"}</ul></div><div><h4>추천</h4><ul class="tree">${rec || `<li class="empty">Claude가 판단한 뒤 채워져요(review.json)</li>`}</ul></div></div>`;
    if (r?.items?.length) {
      html += `<div class="cards">` + r.items.map((it) => `<details class="card ${GRADE_CLASS[it.grade] || "info"}" ${it.grade === "fail" ? "open" : ""}><summary>${badge(it.grade)}<span class="name">${esc(it.name)}</span></summary>${it.why ? `<p class="why">왜? ${esc(it.why)}</p>` : ""}${it.now ? `<p><b>지금</b> ${esc(it.now)}</p>` : ""}${it.fix ? `<p><b>이렇게</b> ${esc(it.fix)}</p>` : ""}</details>`).join("") + `</div>`;
    }
    const f = p.facts || {};
    const factRow = (k, v) => `<tr><th>${k}</th><td>${v?.length ? esc(v.join(", ")) : `<span class="miss">글자로 없음</span>`}</td></tr>`;
    html += `<table class="facts">${factRow("전화", f.phone)}${factRow("이메일", f.email)}${factRow("가격", f.price)}${factRow("주소", f.address)}${factRow("시간", f.hours)}</table>`;
  }
  if (review?.todo?.length) html += `<h3>✎ 채울 것 (내 정보가 필요해요)</h3><ul class="todo">${review.todo.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>`;
  return html;
}

// ── 탭 3 · 등록 진행 ──
const DEFAULT_STEPS = [
  ["gsc-add", "구글", "서치콘솔에 사이트 추가(URL 접두어)"],
  ["gsc-verify", "구글", "소유 확인(HTML 태그)"],
  ["gsc-sitemap", "구글", "사이트맵 제출"],
  ["gsc-request", "구글", "홈 · 핵심 페이지 색인 요청"],
  ["bing-import", "빙", "서치콘솔에서 가져오기"],
  ["naver-add", "네이버", "서치어드바이저에 사이트 추가"],
  ["naver-verify", "네이버", "소유 확인(HTML 태그)"],
  ["naver-sitemap", "네이버", "사이트맵 제출"],
  ["naver-collect", "네이버", "웹 페이지 수집 요청"],
  ["indexnow", "빙 · 네이버", "IndexNow로 한 번에 알리기"],
];
function registerTab() {
  const saved = Object.fromEntries((register?.steps || []).map((s) => [s.id, s]));
  const rows = DEFAULT_STEPS.map(([id, engine, name]) => {
    const s = saved[id] || { status: "todo" };
    const label = { done: "끝", doing: "진행 중", todo: "아직", skip: "건너뜀", fail: "막힘" }[s.status] || s.status;
    return `<tr><td>${badge(s.status === "fail" ? "fail" : s.status)}</td><td>${esc(engine)}</td><td>${esc(name)}</td><td>${esc(label)}</td><td>${esc(s.at || "")}</td><td>${esc(s.note || "")}</td></tr>`;
  }).join("");
  return `<p class="why">왜? 검색엔진에 「새 사이트가 생겼어요」라고 직접 알리는 단계예요. 요청해도 검색에 나오기까지 며칠~몇 주 걸려요.</p><table class="steps"><thead><tr><th></th><th>어디</th><th>할 일</th><th>상태</th><th>언제</th><th>메모</th></tr></thead><tbody>${rows}</tbody></table>`;
}

// ── 탭 4 · 측정 ──
function measureTab() {
  if (!measure?.questions?.length) return `<p class="empty">아직 측정 질문을 정하지 않았어요. 「측정 질문 만들어 줘」라고 해 보세요.</p>`;
  const engines = ["ChatGPT", "Perplexity", "네이버 AI 브리핑", "구글 AI 모드"];
  const head = `<tr><th>질문</th>${engines.map((e) => `<th>${e}</th>`).join("")}</tr>`;
  const rows = measure.questions.map((q) => `<tr><td>${esc(q)}</td>${engines.map(() => `<td class="blank"></td>`).join("")}</tr>`).join("");
  return `<p class="why">왜? 효과는 며칠~몇 주 뒤에 나와요. 같은 질문으로 전후를 비교해야 변화가 보여요.</p>${measure.due ? `<p><b>물어볼 날</b> ${esc(measure.due)}</p>` : ""}<table class="measure">${head}${rows}</table><p class="meta">칸에는 「내 사이트가 나왔나 · 몇 번째 · 어떤 문장으로」를 적어요.</p>`;
}

// ── 고쳐 줘 프롬프트 ──
function fixPrompt() {
  const fails = (check?.checks || []).filter((c) => c.grade === "fail").map((c) => c.name);
  const warns = (check?.checks || []).filter((c) => c.grade === "warn").map((c) => c.name);
  const items = (review?.pages || []).flatMap((p) => (p.items || []).filter((i) => i.grade === "fail" || i.grade === "warn").map((i) => i.name));
  if (!fails.length && !warns.length && !items.length) return "";
  const text = `seo-check 리포트를 보고 고쳐 줘.\n먼저 ✕: ${fails.join(", ") || "없음"}\n그다음 △: ${warns.join(", ") || "없음"}\n글 구조: ${[...new Set(items)].join(", ") || "없음"}\n없는 사실 · 숫자 · 후기는 만들지 말고 「✎ 채울 것」으로 남겨 줘. 고친 뒤 무엇을 바꿨는지 표로 보여 줘.`;
  return `<section class="fix"><h3>Claude에게 이렇게 말하세요</h3><pre id="fix">${esc(text)}</pre><button onclick="navigator.clipboard.writeText(document.getElementById('fix').innerText);this.textContent='복사했어요'">복사</button></section>`;
}

const site = check?.finalUrl || outline?.url || "";
const page = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>내 사이트 검색 점검</title>
<style>
:root{--bg:#fafaf8;--fg:#1d1d1b;--muted:#6b6b66;--line:#e4e3de;--card:#fff;--pass:#1f8a4c;--warn:#b7791f;--fail:#c53030;--todo:#3b6fd8;--accent:#1d1d1b}
@media (prefers-color-scheme:dark){:root{--bg:#161615;--fg:#ecebe6;--muted:#9b9a94;--line:#2c2b29;--card:#1f1f1d;--pass:#4ec27e;--warn:#e0a84a;--fail:#f07070;--todo:#7aa2f7;--accent:#ecebe6}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 -apple-system,BlinkMacSystemFont,"Pretendard","Apple SD Gothic Neo",sans-serif}
main{max-width:920px;margin:0 auto;padding:32px 16px 80px}
header h1{font-size:24px;margin:0 0 4px}header p{margin:0;color:var(--muted)}
.intro{margin:20px 0;padding:16px;border:1px solid var(--line);border-radius:12px;background:var(--card)}
.intro p{margin:4px 0}
nav{display:flex;gap:6px;margin:24px 0 16px;flex-wrap:wrap}
nav button{border:1px solid var(--line);background:var(--card);color:var(--fg);padding:8px 14px;border-radius:999px;font:inherit;cursor:pointer}
nav button.on{background:var(--accent);color:var(--bg);border-color:var(--accent)}
section.tab{display:none}section.tab.on{display:block}
h3{margin:28px 0 10px;font-size:17px}h4{margin:0 0 8px;font-size:14px;color:var(--muted)}
.score{display:flex;gap:12px;flex-wrap:wrap}.score div{flex:1;min-width:120px;padding:14px;border:1px solid var(--line);border-radius:12px;background:var(--card)}
.score b{display:block;font-size:28px}.score span{color:var(--muted);font-size:13px}
.pass{color:var(--pass)}.warn{color:var(--warn)}.fail{color:var(--fail)}.todo{color:var(--todo)}.info{color:var(--muted)}
.cards{display:grid;gap:8px}
.card{border:1px solid var(--line);border-left:4px solid var(--line);border-radius:10px;background:var(--card);padding:10px 14px}
.card.pass{border-left-color:var(--pass)}.card.warn{border-left-color:var(--warn)}.card.fail{border-left-color:var(--fail)}.card.todo{border-left-color:var(--todo)}
.card summary{cursor:pointer;display:flex;gap:10px;align-items:center;color:var(--fg)}
.mark{font-weight:700;width:1.2em;text-align:center}
.why{color:var(--muted);margin:8px 0}
pre{white-space:pre-wrap;word-break:break-all;background:var(--bg);border-radius:8px;padding:10px;margin:6px 0 0;font:13px/1.55 ui-monospace,Menlo,monospace;color:var(--fg)}
.alert{padding:12px 14px;border-radius:10px;background:color-mix(in srgb,var(--fail) 12%,transparent);margin:12px 0}
.note{padding:12px 14px;border-radius:10px;background:var(--card);border:1px solid var(--line);margin:12px 0}
.compare{display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media (max-width:640px){.compare{grid-template-columns:1fr}}
.compare>div{border:1px solid var(--line);border-radius:12px;padding:12px;background:var(--card)}
.tree{list-style:none;margin:0;padding:0}.tree li{padding:4px 0;border-bottom:1px dashed var(--line)}
.tree li:last-child{border:0}.tree b{font-size:11px;color:var(--muted);margin-right:4px}
.tree .l2{padding-left:14px}.tree .l3{padding-left:28px}.tree .l4,.tree .l5,.tree .l6{padding-left:42px}
.tree small{display:block;color:var(--muted);font-size:12px}.tree small.hint{color:var(--todo)}
table{width:100%;border-collapse:collapse;margin:10px 0;background:var(--card);border-radius:10px;overflow:hidden}
th,td{border:1px solid var(--line);padding:8px 10px;text-align:left;vertical-align:top;font-size:14px}
th{color:var(--muted);font-weight:600}
.facts th{width:80px}.miss{color:var(--warn)}
td.blank{min-width:90px}
.todo li{margin:4px 0}
.fix{margin-top:32px;padding:16px;border:1px solid var(--line);border-radius:12px;background:var(--card)}
.fix button{margin-top:8px;border:0;background:var(--accent);color:var(--bg);padding:8px 16px;border-radius:8px;font:inherit;cursor:pointer}
.empty{color:var(--muted)}.meta{color:var(--muted);font-size:13px;margin-top:16px}
</style></head><body><main>
<header><h1>내 사이트 검색 점검</h1><p>${esc(site)}</p></header>
<div class="intro">
<p><b>왜 하나요?</b> 사이트를 만들어도 검색엔진과 AI가 모르면 아무도 찾아오지 못해요. 여기서 「찾아오고 · 읽고 · 소개할 수 있는지」를 봐요.</p>
<p><b>SEO</b> 구글 · 네이버 검색 결과 목록에 뜨게 하기 · <b>GEO</b> ChatGPT · 네이버 AI 브리핑 같은 AI 답변에 인용되게 하기. AI도 검색엔진이 모아 둔 페이지를 보고 답하니, SEO가 바닥이에요.</p>
</div>
<nav><button class="on" data-t="t1">① 기술 점검</button><button data-t="t2">② 글 구조</button><button data-t="t3">③ 색인 등록</button><button data-t="t4">④ 측정</button></nav>
<section class="tab on" id="t1"><p class="why">왜? 검색엔진과 AI 봇이 내 사이트에 들어와서 글자를 읽을 수 있는지 봐요. 문이 잠겨 있으면 내용이 좋아도 소용없어요.</p>${techTab()}</section>
<section class="tab" id="t2"><p class="why">왜? AI는 질문에 딱 맞는 한두 문장을 뽑아서 답해요. 그 문장이 찾기 쉬운 자리에 있어야 인용돼요.</p>${structureTab()}</section>
<section class="tab" id="t3">${registerTab()}</section>
<section class="tab" id="t4">${measureTab()}</section>
${fixPrompt()}
<p class="meta">site-seo-geo · 셀피쉬클럽 · ${esc(new Date().toLocaleString("ko-KR"))}</p>
</main>
<script>
document.querySelectorAll("nav button").forEach(b=>b.onclick=()=>{document.querySelectorAll("nav button,section.tab").forEach(x=>x.classList.remove("on"));b.classList.add("on");document.getElementById(b.dataset.t).classList.add("on")});
</script></body></html>`;

const file = path.join(outDir, "report.html");
fs.writeFileSync(file, page);
console.log(`리포트: ${file}`);
if (args.open) {
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  execFile(opener, [file], () => {});
}
