# 기술 점검 16가지 · 기준과 고치는 법

판정은 `check.mjs`가 한다. 이 문서는 **설명과 고치는 법**을 담는다. 채팅에서 설명할 때는 각 항목의 「쉬운 말」을 쓴다.

## 판정 기호
- ○ 좋아요 · △ 고치면 좋아요 · ✕ 꼭 고쳐요 · ☐ 등록 단계에서 할 일 · `·` 참고(점수 없음)

---

## A. 들어올 수 있나

| 항목 | 쉬운 말 | ✕ 기준 | 고치는 법 |
|---|---|---|---|
| 정상 열림 | 주소를 열면 페이지가 제대로 나와야 해요 | 200이 아님 | 배포 상태 확인. 넘겨주기가 2번 이상이면 최종 주소 하나로 정리 |
| 「검색 금지」 표시 없음 | noindex가 있으면 검색 결과에 안 넣어요 | meta robots · X-Robots-Tag에 noindex | 코드에서 `noindex` 찾아 지우기. **미리보기 주소라서 붙은 거면 진짜 주소로 다시 점검** |
| robots.txt | 봇에게 「어디까지 들어와도 되는지」 알려 주는 안내문 | `Disallow: /`로 전체 막힘 | 아래 「robots.txt 기본형」 |
| 검색 · AI 봇으로 받아 보기 | ChatGPT · Claude · Perplexity · 네이버 봇이 실제로 글자를 가져가는지 | 봇 이름으로 403 · robots에서 막힘 | robots.txt에서 해당 봇 허용. 403이면 Vercel 대시보드 › Firewall · Bot Protection을 **사람이** 확인 |

### robots.txt 기본형
```
User-agent: *
Allow: /

Sitemap: https://내주소/sitemap.xml
```
AI 학습용 봇(GPTBot · ClaudeBot · Google-Extended)을 막을지는 사용자가 정한다. **검색용 봇(OAI-SearchBot · PerplexityBot · Googlebot · Yeti · bingbot)은 막으면 AI 검색 답변에 안 나온다**고 꼭 알려 준다.

---

## B. 길 안내가 있나

| 항목 | 쉬운 말 | ✕ 기준 | 고치는 법 |
|---|---|---|---|
| sitemap.xml | 「이런 페이지들이 있어요」 목록 | 없음 · 다른 주소(미리보기 · 예전 도메인) 섞임 | 아래 스택별 |
| 메뉴가 진짜 링크 | 봇은 버튼을 못 누르고 `<a href>`만 따라가요 | 사이트맵엔 페이지가 여럿인데 홈에서 가는 링크 없음 · `#/` 주소 | `onClick` 이동을 `<a href="/about">`(Next는 `<Link href>`)로 바꾸기. `HashRouter` → `BrowserRouter` |
| 대표 주소(canonical) | 「이 페이지의 진짜 주소는 여기예요」 | 다른 주소 · 미리보기 주소를 가리킴 | 페이지마다 자기 주소를 진짜 도메인으로 |
| 없는 주소는 404 | 없는 주소가 정상처럼 열리면 빈 페이지가 잔뜩 모여요 | 없는 주소가 200 | Next: `app/not-found.tsx`. HTML: 루트에 `404.html`. Vite SPA: 아래 |

---

## C. 글자로 읽히나

| 항목 | 쉬운 말 | ✕ 기준 | 고치는 법 |
|---|---|---|---|
| **자바스크립트 없이 보이는 글자** | 대부분의 AI 봇은 처음 받은 HTML의 글자만 읽어요 | 80자 미만(△ 300자 미만) | 아래 「SPA 글자 문제」 |
| H1 하나 | 「이 페이지는 무엇에 대한 것인가」 대표 제목 | 없음(△ 여러 개) | 페이지 맨 위 큰 제목 하나만 `<h1>`, 나머지는 `<h2>` |
| lang · viewport | 언어 표시 · 휴대폰 화면 설정 | 없음 | `<html lang="ko">`, `<meta name="viewport" content="width=device-width, initial-scale=1">` |
| 이미지 설명(alt) | 봇은 그림을 못 보고 alt로 알아요 | 절반 넘게 alt 없음 | 의미 있는 그림은 `alt="무엇인지"`, 꾸밈 그림은 `alt=""` |

### SPA 글자 문제 (React · Vite에서 가장 많이 걸림)
화면을 자바스크립트가 그리면 처음 받은 HTML은 `<div id="root"></div>`뿐이다. 구글은 나중에 그려 보기도 하지만, ChatGPT · Claude · Perplexity 봇은 대부분 그리지 않는다.
- **Next.js · Astro**: 보통 문제없다. `"use client"` 페이지에서 데이터를 브라우저에서만 불러오면 생길 수 있다. 핵심 글은 서버에서 그리게 한다.
- **Vite React(수업용 빠른 방법)**: `index.html`의 `<div id="root">` **안에** 화면과 같은 핵심 글(H1 · 한 줄 소개 · 하는 일 · 연락처)을 그냥 HTML로 넣는다. React가 뜨면 그 자리를 덮어써서 사람 눈에는 그대로다. **화면 내용과 똑같이** 쓴다. 다르게 쓰면 검색엔진이 속임수로 본다.
- **Vite React(제대로)**: 페이지마다 미리 HTML을 만드는 프리렌더, 또는 Next.js · Astro로 옮기기. 수업 범위 밖이라 방향만 안내한다.

---

## D. 소개가 정확한가

| 항목 | 쉬운 말 | ✕ 기준 | 고치는 법 |
|---|---|---|---|
| 페이지별 제목 · 설명 | 검색 결과의 파란 제목과 그 아래 설명 | 없음(△ 페이지끼리 같음 · 제목 60자 넘음) | 제목: 「무엇 · 누구 \| 사이트 이름」 30~60자. 설명: 누구에게 무엇을 하는지 80~150자 |
| 구조화 데이터 | 「사이트 주인은 이런 사람/가게예요」를 기계가 읽는 말로 | 없음 · JSON 오류(△ 「누구인지」 표시 없음) | 아래 템플릿 |
| 공유 카드(OG) · 파비콘 | 카톡 · 스레드에 링크 붙일 때 뜨는 카드, 탭 아이콘 | og:image 없음(△ 상대 주소 · 파비콘 없음) | `og:image`는 `https://`로 시작하는 전체 주소, 1200×630 |
| 소유 확인 태그 | 「이 사이트 주인이 나예요」 증명 | ☐ (등록 단계에서 넣음) | register.md |

### 구조화 데이터 템플릿 (홈 하나에만, 해당하는 것 하나)
값은 사이트에 있는 사실만 넣는다. 모르면 그 줄을 지우고 리포트 「✎ 채울 것」에 남긴다.
```json
{ "@context": "https://schema.org", "@type": "Person",
  "name": "이름", "jobTitle": "하는 일", "url": "https://내주소",
  "description": "한 줄 소개", "sameAs": ["https://instagram.com/…", "https://threads.com/@…"] }
```
```json
{ "@context": "https://schema.org", "@type": "LocalBusiness",
  "name": "가게 이름", "url": "https://내주소", "telephone": "010-…",
  "address": { "@type": "PostalAddress", "addressRegion": "서울", "addressLocality": "강남구", "streetAddress": "…" },
  "openingHours": "Mo-Fr 10:00-19:00", "sameAs": ["https://map.naver.com/…"] }
```
```json
{ "@context": "https://schema.org", "@type": "Organization",
  "name": "회사/브랜드 이름", "url": "https://내주소", "logo": "https://내주소/logo.png",
  "description": "한 줄 소개", "sameAs": ["…"] }
```
FAQ 칸이 있으면 `FAQPage`도 넣는다. 질문과 답은 화면에 보이는 글과 똑같이 쓴다.

---

## 스택별 넣는 자리

### Next.js (App Router)
```ts
// app/layout.tsx
export const metadata = {
  metadataBase: new URL("https://내주소"),
  title: { default: "사이트 제목", template: "%s | 사이트 이름" },
  description: "누구에게 무엇을 하는지",
  alternates: { canonical: "/" },
  openGraph: { images: ["/og.png"] },
  verification: { google: "구글 값", other: { "naver-site-verification": "네이버 값" } },
};
// <html lang="ko"> 확인
```
- 페이지마다 `export const metadata = { title, description, alternates: { canonical: "/경로" } }`
- `app/robots.ts`, `app/sitemap.ts`(MetadataRoute) · `app/not-found.tsx`
- 구조화 데이터: layout 또는 홈 page에 `<script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />`

### Vite React
- `index.html`의 `<head>`: title · description · canonical · og · 소유 확인 meta · JSON-LD `<script>`
- `public/robots.txt`, `public/sitemap.xml`(페이지 주소를 손으로 적음)
- 페이지가 여럿이면 SPA는 처음 HTML이 하나라 **제목 · 설명이 모든 페이지에서 같다**(△). 핵심 페이지가 홈 하나면 괜찮다고 설명한다.
- 404: `vercel.json`에 `{"source":"/(.*)","destination":"/"}` 같은 「전부 홈으로」 규칙이 있으면 없는 주소도 200이 된다. 실제 경로만 적는 규칙으로 바꾸거나, 그대로 두고 △로 설명한다.

### HTML
- 각 `.html`의 `<head>`에 직접 넣는다. 루트에 `robots.txt` · `sitemap.xml` · `404.html`.

### Astro
- 공용 레이아웃의 `<head>`에 넣는다. `@astrojs/sitemap` 통합이 있으면 사이트맵은 자동이다. `src/pages/404.astro`.
