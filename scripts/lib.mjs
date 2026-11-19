// 공통 도구: 주소 받기 · HTML에서 필요한 것 뽑기 · 결과 파일 쓰기
// Node 18 이상만 있으면 된다(외부 패키지 없음).
import fs from "node:fs";
import path from "node:path";

export const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36 site-seo-geo";

// 검색 · AI 봇 이름(User-Agent). robots.txt 판정에는 token을 쓴다.
export const BOTS = [
  { token: "Googlebot", label: "구글", ua: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" },
  { token: "bingbot", label: "빙", ua: "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)" },
  { token: "Yeti", label: "네이버", ua: "Mozilla/5.0 (compatible; Yeti/1.1; +https://naver.me/spd)" },
  { token: "OAI-SearchBot", label: "ChatGPT 검색", ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot" },
  { token: "GPTBot", label: "ChatGPT 학습", ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot" },
  { token: "ClaudeBot", label: "Claude", ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ClaudeBot/1.0; +claudebot@anthropic.com" },
  { token: "PerplexityBot", label: "Perplexity", ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)" },
];

// 명령줄 인자: 첫 번째 값은 주소, --키=값 / --키 값 형태 옵션
export function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=");
      if (v !== undefined) args[k] = v;
      else if (argv[i + 1] && !argv[i + 1].startsWith("--")) args[k] = argv[++i];
      else args[k] = true;
    } else args._.push(a);
  }
  return args;
}

export function normalizeUrl(input) {
  if (!input) return null;
  let s = String(input).trim();
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  const u = new URL(s);
  if (!u.pathname) u.pathname = "/";
  u.hash = "";
  return u.toString();
}

// Vercel 미리보기 · 해시 주소인지(검색엔진이 무시하는 주소)
export function previewKind(url) {
  const host = new URL(url).hostname;
  if (/^localhost$|^127\.|^192\.168\.|\.local$/.test(host)) return "내 컴퓨터 주소";
  if (/\.vercel\.app$/.test(host)) {
    const sub = host.replace(/\.vercel\.app$/, "");
    if (/-git-/.test(sub)) return "Vercel 브랜치 미리보기 주소";
    // 프로젝트-해시9자리-팀이름.vercel.app (해시는 글자와 숫자가 섞여 있다)
    const hashed = sub.split("-").some((part, i, all) => i > 0 && i < all.length - 1 && /^[a-z0-9]{9}$/.test(part) && /\d/.test(part) && /[a-z]/.test(part));
    if (hashed) return "Vercel 해시 배포 주소";
  }
  if (/\.netlify\.app$/.test(host) && /^deploy-preview-|--/.test(host)) return "Netlify 미리보기 주소";
  return null;
}

// 리다이렉트를 하나씩 따라가며 기록한다.
export async function fetchPage(url, { ua = BROWSER_UA, timeout = 15000, maxRedirects = 6 } = {}) {
  const hops = [];
  let current = url;
  for (let i = 0; i <= maxRedirects; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    let res;
    try {
      res = await fetch(current, { redirect: "manual", headers: { "user-agent": ua, accept: "text/html,application/xhtml+xml,*/*", "accept-language": "ko-KR,ko;q=0.9,en;q=0.5" }, signal: ctrl.signal });
    } catch (e) {
      clearTimeout(timer);
      return { ok: false, error: e.name === "AbortError" ? "시간 초과" : e.message, url: current, hops };
    }
    clearTimeout(timer);
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      const next = new URL(res.headers.get("location"), current).toString();
      hops.push({ from: current, to: next, status: res.status });
      current = next;
      continue;
    }
    const body = await res.text().catch(() => "");
    return { ok: true, status: res.status, url: current, hops, headers: Object.fromEntries(res.headers.entries()), body };
  }
  return { ok: false, error: "리다이렉트가 너무 많음", url: current, hops };
}

// ── HTML 뽑기 (정규식 기반 · 자바스크립트를 실행하지 않은 원본 HTML 기준) ──

export function decodeEntities(s = "") {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

export function stripTags(html = "") {
  return decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

// 태그의 속성들을 객체로
export function attrs(tag) {
  const out = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  const inner = tag.replace(/^<\s*[a-zA-Z0-9-]+/, "").replace(/\/?>$/, "");
  let m;
  while ((m = re.exec(inner))) out[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  return out;
}

export function findTags(html, name) {
  return [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, "gi"))].map((m) => attrs(m[0]));
}

export function metaContent(html, key) {
  const k = key.toLowerCase();
  const tag = findTags(html, "meta").find((a) => (a.name || a.property || "").toLowerCase() === k);
  return tag ? tag.content ?? "" : null;
}

// 화면에 보이는 글자만(스크립트 · 스타일 · svg 제외)
export function visibleText(html = "") {
  const body = (html.match(/<body\b[^>]*>([\s\S]*)<\/body>/i) || [, html])[1];
  return stripTags(
    body
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<svg\b[\s\S]*?<\/svg>/gi, " ")
      .replace(/<template\b[\s\S]*?<\/template>/gi, " ")
  );
}

export function title(html) {
  const m = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return m ? stripTags(m[1]) : null;
}

export function headings(html, level) {
  return [...html.matchAll(new RegExp(`<h${level}\\b[^>]*>([\\s\\S]*?)<\\/h${level}>`, "gi"))].map((m) => stripTags(m[1]));
}

export function jsonLdTypes(html) {
  const types = [];
  const errors = [];
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(m[1].trim());
      const walk = (d) => {
        if (!d || typeof d !== "object") return;
        if (Array.isArray(d)) return d.forEach(walk);
        if (d["@type"]) [].concat(d["@type"]).forEach((t) => types.push(String(t)));
        if (d["@graph"]) walk(d["@graph"]);
      };
      walk(data);
    } catch {
      errors.push("JSON 형식 오류");
    }
  }
  return { types, errors };
}

export function links(html, baseUrl) {
  const base = new URL(baseUrl);
  const out = [];
  for (const a of findTags(html, "a")) {
    if (!a.href) continue;
    const href = a.href.trim();
    if (/^(mailto:|tel:|javascript:|data:)/i.test(href)) continue;
    try {
      const u = new URL(href, base);
      out.push({ href, url: u.toString(), internal: u.hostname === base.hostname, hashRoute: /^#\/|^\/#\//.test(href) });
    } catch {}
  }
  return out;
}

// robots.txt 해석: 봇 이름별 규칙 묶음
export function parseRobots(text = "") {
  const groups = [];
  const sitemaps = [];
  let cur = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const i = line.indexOf(":");
    if (i < 0) continue;
    const key = line.slice(0, i).trim().toLowerCase();
    const val = line.slice(i + 1).trim();
    if (key === "user-agent") {
      if (!lastWasAgent || !cur) {
        cur = { agents: [], rules: [] };
        groups.push(cur);
      }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (key === "sitemap") sitemaps.push(val);
      else if (cur && (key === "allow" || key === "disallow")) cur.rules.push({ type: key, path: val });
    }
  }
  return { groups, sitemaps };
}

// 이 봇이 이 경로를 가져갈 수 있는지(가장 긴 규칙이 이긴다)
export function robotsAllows(parsed, token, pathname = "/") {
  const t = token.toLowerCase();
  let group = parsed.groups.find((g) => g.agents.some((a) => a !== "*" && t.includes(a)));
  if (!group) group = parsed.groups.find((g) => g.agents.includes("*"));
  if (!group) return { allowed: true, by: "규칙 없음" };
  let best = null;
  for (const r of group.rules) {
    if (r.type === "disallow" && r.path === "") continue;
    const pattern = "^" + r.path.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$");
    if (new RegExp(pattern).test(pathname)) {
      if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.type === "allow")) best = r;
    }
  }
  return { allowed: !best || best.type === "allow", by: best ? `${best.type}: ${best.path}` : "막는 규칙 없음", group: group.agents.join(", ") };
}

export function sitemapLocs(xml = "") {
  return [...xml.matchAll(/<loc>\s*([\s\S]*?)\s*<\/loc>/gi)].map((m) => decodeEntities(m[1].trim()));
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeJson(file, data) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

export const MARK = { pass: "○", warn: "△", fail: "✕", todo: "☐", info: "·" };
