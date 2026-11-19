#!/usr/bin/env node
// IndexNow · 로그인 없이 빙 · 네이버에 「바뀐 페이지 있어요」 알리기 (구글은 받지 않음)
//
// 1) 키 만들기: node indexnow.mjs key [--public 폴더]
//    → 사이트의 공개 폴더(public/ · static/ · 없으면 지금 폴더)에 <키>.txt 를 만든다.
//    → 배포(push)해야 진짜 주소에서 키 파일이 보인다.
// 2) 알리기:   node indexnow.mjs send <사이트 주소> [--urls 주소1,주소2] [--dry]
//    → 키 파일이 진짜 주소에 보이는지 먼저 확인하고, 사이트맵의 주소(최대 100개)를 보낸다.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { parseArgs, normalizeUrl, fetchPage, parseRobots, sitemapLocs, readJson, writeJson } from "./lib.mjs";

const args = parseArgs(process.argv.slice(2));
const [cmd, target] = args._;
const outDir = path.resolve(args.out || "seo-check");
const stateFile = path.join(outDir, "indexnow.json");
const say = (s) => process.stdout.write(s + "\n");

function publicDir() {
  if (args.public) return path.resolve(args.public);
  for (const d of ["public", "static"]) if (fs.existsSync(d) && fs.statSync(d).isDirectory()) return path.resolve(d);
  return process.cwd();
}

function markRegister(status, note) {
  const file = path.join(outDir, "register.json");
  const reg = readJson(file, { steps: [] });
  const at = new Date().toISOString().slice(0, 16).replace("T", " ");
  const i = reg.steps.findIndex((s) => s.id === "indexnow");
  const step = { id: "indexnow", status, at, note };
  if (i >= 0) reg.steps[i] = step; else reg.steps.push(step);
  writeJson(file, reg);
}

if (cmd === "key") {
  const prev = readJson(stateFile);
  const key = prev?.key || crypto.randomBytes(16).toString("hex");
  const dir = publicDir();
  const file = path.join(dir, `${key}.txt`);
  fs.writeFileSync(file, key);
  writeJson(stateFile, { key, file: path.relative(process.cwd(), file), createdAt: prev?.createdAt || new Date().toISOString() });
  say(`키 파일을 만들었어요: ${path.relative(process.cwd(), file)}`);
  say("배포(push)한 뒤 `node indexnow.mjs send <사이트 주소>` 로 알려요.");
  process.exit(0);
}

if (cmd === "send") {
  const site = normalizeUrl(target);
  const state = readJson(stateFile);
  if (!site || !state?.key) {
    console.error("먼저 `node indexnow.mjs key` 로 키를 만들고 배포해 주세요. 사용: node indexnow.mjs send <사이트 주소>");
    process.exit(1);
  }
  const origin = new URL(site).origin;
  const keyLocation = `${origin}/${state.key}.txt`;
  const k = await fetchPage(keyLocation);
  if (!k.ok || k.status !== 200 || k.body.trim() !== state.key) {
    say(`✕ 진짜 주소에서 키 파일이 안 보여요: ${keyLocation} (응답 ${k.status ?? k.error})`);
    say("  배포가 끝났는지, 키 파일이 공개 폴더(public/ 등)에 있는지 확인해 주세요.");
    markRegister("fail", "키 파일이 진짜 주소에 안 보임");
    process.exit(2);
  }
  let urls = args.urls ? String(args.urls).split(",").map((u) => u.trim()).filter(Boolean) : [];
  if (!urls.length) {
    const robots = await fetchPage(origin + "/robots.txt");
    const sm = [...(robots.ok ? parseRobots(robots.body).sitemaps : []), origin + "/sitemap.xml"];
    for (const s of sm) {
      const r = await fetchPage(s);
      if (r.ok && r.status === 200) {
        let locs = sitemapLocs(r.body);
        if (/<sitemapindex\b/i.test(r.body)) {
          const kids = locs.slice(0, 5); locs = [];
          for (const c of kids) { const x = await fetchPage(c); if (x.ok) locs.push(...sitemapLocs(x.body)); }
        }
        urls = locs;
        break;
      }
    }
  }
  const host = new URL(site).hostname;
  urls = [...new Set(urls)].filter((u) => { try { return new URL(u).hostname === host; } catch { return false; } }).slice(0, 100);
  if (!urls.length) urls = [site];
  const payload = { host, key: state.key, keyLocation, urlList: urls };
  say(`보낼 주소 ${urls.length}개 (예: ${urls.slice(0, 3).join(", ")})`);
  if (args.dry) { say("--dry 라서 보내지 않았어요."); process.exit(0); }
  const res = await fetch("https://api.indexnow.org/indexnow", {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload),
  });
  const meaning = {
    200: "받았어요", 202: "받았어요(키 확인 중)", 400: "형식이 잘못됐어요", 403: "키가 맞지 않아요",
    422: "주소가 이 사이트 것이 아니에요", 429: "너무 자주 보냈어요. 나중에 다시",
  }[res.status] || "알 수 없는 응답";
  say(`${res.ok ? "○" : "✕"} IndexNow 응답 ${res.status} · ${meaning}`);
  say("  빙 · 네이버 등 IndexNow에 참여한 검색엔진에 함께 전달돼요. 구글은 받지 않아요.");
  markRegister(res.ok ? "done" : "fail", `${urls.length}개 · 응답 ${res.status} ${meaning}`);
  process.exit(res.ok ? 0 : 3);
}

say("사용법:\n  node indexnow.mjs key [--public 폴더]\n  node indexnow.mjs send <사이트 주소> [--urls a,b] [--dry]");
