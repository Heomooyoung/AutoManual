# StepHow Clone - 설계 문서

> **Summary**: Chrome 확장 프로그램으로 클릭 이벤트 자동 캡처 → 편집 → 다중 형식 내보내기 매뉴얼 생성 도구
>
> **Project**: 매뉴얼 생성 프로그램 (StepHow Clone)
> **Version**: 0.1.0
> **Author**: heomuyeong
> **Date**: 2026-03-18
> **Status**: Draft
> **Planning Doc**: [stephow-clone.plan.md](../01-plan/features/stephow-clone.plan.md)

---

## 1. Overview

### 1.1 Design Goals

- 클릭 한 번으로 녹화 시작, 업무 수행 후 자동으로 매뉴얼 완성
- 서버 없이 100% 로컬에서 동작 (보안, 비용 모두 해결)
- 입문자도 코드를 이해할 수 있는 단순한 구조
- HTML/PDF/PPT/GIF 4가지 형식으로 내보내기

### 1.2 Design Principles

- **단순함 우선**: 빌드 도구 없이 순수 HTML/CSS/JS로 개발
- **모듈 분리**: 각 기능(캡처, 편집, 내보내기)을 독립 파일로 관리
- **로컬 우선**: 모든 데이터는 사용자 브라우저에만 저장

---

## 2. 기술 스택 (전부 무료)

### 2.1 핵심 스택

| 역할 | 기술 | 버전 | 라이선스 | 선택 이유 |
|------|------|------|---------|-----------|
| **플랫폼** | Chrome Extension (Manifest V3) | V3 | 무료 | 클릭 감지 + 화면 캡처 필수 |
| **언어** | JavaScript (ES2020+) | - | 무료 | 빌드 불필요, 입문자 친화적 |
| **스타일** | CSS3 | - | 무료 | 프레임워크 없이 깔끔한 UI |
| **데이터 저장** | IndexedDB (Dexie.js 래퍼) | 4.x | Apache 2.0 | IndexedDB를 쉽게 사용하는 헬퍼 |
| **이미지 처리** | Canvas API (브라우저 내장) | - | 무료 | 클릭 위치 표시, 이미지 리사이즈 |

### 2.2 내보내기 라이브러리

| 형식 | 라이브러리 | 크기 | 라이선스 | CDN 사용 |
|------|-----------|------|---------|----------|
| **PDF** | jsPDF + html2canvas | ~300KB | MIT | ✅ |
| **PPT** | PptxGenJS | ~200KB | MIT | ✅ |
| **GIF** | gif.js | ~50KB | MIT | ✅ (Worker 포함) |
| **HTML** | 순수 JS (라이브러리 불필요) | 0KB | - | - |

### 2.3 유틸리티 라이브러리

| 역할 | 라이브러리 | 크기 | 라이선스 | 선택 이유 |
|------|-----------|------|---------|-----------|
| **드래그&드롭** | SortableJS | ~40KB | MIT | 단계 순서 변경, 의존성 없음 |
| **아이콘** | Lucide Icons (SVG) | 필요분만 | ISC | 가볍고 깔끔한 SVG 아이콘 |

### 2.4 스택 선택 근거

```
왜 Dexie.js? (IndexedDB 래퍼)
───────────────────────────────
순수 IndexedDB API는 코드가 복잡함:
  const request = indexedDB.open('db', 1);
  request.onupgradeneeded = (e) => { ... };
  request.onsuccess = (e) => { ... };

Dexie.js를 쓰면 간단해짐:
  const db = new Dexie('StepHowDB');
  db.version(1).stores({ steps: '++id, manualId' });
  await db.steps.add({ ... });

→ 코드량 70% 감소, 입문자도 이해 가능
```

---

## 3. Architecture

### 3.1 Chrome Extension 구성도

```
┌─────────────────────────────────────────────────────────┐
│                    Chrome Browser                        │
│                                                          │
│  ┌──────────────┐    메시지     ┌───────────────────┐    │
│  │ Content Script│───────────▶│  Background        │    │
│  │ (content.js) │  클릭 정보   │  (Service Worker)  │    │
│  │              │             │  background.js      │    │
│  │ • 클릭 감지   │◀───────────│  • 스크린샷 캡처    │    │
│  │ • 요소 정보   │  캡처 완료   │  • 이미지 처리     │    │
│  │   추출       │             │  • DB 저장          │    │
│  └──────────────┘             └─────────┬───────────┘    │
│        ▲                                │                │
│        │ 웹페이지에 주입                  │ IndexedDB      │
│        │                                ▼                │
│  ┌─────┴────────────┐          ┌───────────────────┐    │
│  │ 사용자가 방문한    │          │  Side Panel        │    │
│  │ 사내 시스템 페이지  │          │  (sidepanel.html)  │    │
│  │ (ERP, 그룹웨어 등) │          │  • 단계 목록       │    │
│  └──────────────────┘          │  • 설명 편집        │    │
│                                │  • 분기 설정        │    │
│                                │  • 내보내기 버튼    │    │
│                                └─────────┬───────────┘    │
│                                          │                │
│                                          ▼                │
│                                ┌───────────────────┐    │
│                                │  Viewer Page       │    │
│                                │  (viewer.html)     │    │
│                                │  • 매뉴얼 미리보기  │    │
│                                │  • PDF/PPT/GIF     │    │
│                                │    내보내기         │    │
│                                └───────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

### 3.2 파일 구조

```
stephow-extension/
├── manifest.json                 # 확장 프로그램 설정
│
├── background.js                 # Service Worker
│   └── 역할: 스크린샷 캡처, 메시지 라우팅, 녹화 상태 관리
│
├── content.js                    # Content Script (웹페이지에 주입)
│   └── 역할: 클릭 이벤트 감지, 클릭 위치/요소 정보 수집
│
├── content.css                   # 클릭 시 시각적 피드백 스타일
│
├── sidepanel/
│   ├── sidepanel.html            # 사이드 패널 메인 UI
│   ├── sidepanel.css             # 사이드 패널 스타일
│   └── sidepanel.js              # 사이드 패널 로직
│       └── 역할: 단계 목록 표시, 설명 편집, 분기 설정
│
├── viewer/
│   ├── viewer.html               # 매뉴얼 미리보기 페이지
│   ├── viewer.css                # 미리보기 스타일
│   └── viewer.js                 # 미리보기 + 내보내기 로직
│
├── lib/
│   ├── db.js                     # Dexie.js 기반 IndexedDB 관리
│   ├── capture.js                # 스크린샷 캡처 + 클릭 마커 그리기
│   ├── export-html.js            # HTML 내보내기
│   ├── export-pdf.js             # PDF 내보내기 (jsPDF)
│   ├── export-pptx.js            # PPT 내보내기 (PptxGenJS)
│   ├── export-gif.js             # GIF 내보내기 (gif.js)
│   └── branch.js                 # 분기 흐름 데이터 관리
│
├── vendor/                       # 외부 라이브러리 (CDN 대신 로컬 번들)
│   ├── dexie.min.js              # IndexedDB 래퍼
│   ├── jspdf.umd.min.js          # PDF 생성
│   ├── html2canvas.min.js        # HTML → Canvas 변환
│   ├── pptxgen.min.js            # PPT 생성
│   ├── gif.js                    # GIF 생성
│   ├── gif.worker.js             # GIF Worker
│   └── Sortable.min.js           # 드래그&드롭
│
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
│
└── assets/
    └── logo.svg                  # 로고
```

### 3.3 메시지 흐름 (상세)

```
[1] 사용자가 확장 아이콘 클릭 → 녹화 시작
    sidepanel.js → chrome.runtime.sendMessage({ type: 'START_RECORDING' })
    → background.js: 녹화 상태 ON, 아이콘 배지 "REC"

[2] 사용자가 웹페이지에서 클릭
    content.js: document.addEventListener('click', handler)
    → 클릭 좌표(x, y), 요소 정보(tagName, innerText, id, className) 수집
    → chrome.runtime.sendMessage({ type: 'CLICK_EVENT', data: {...} })

[3] background.js가 메시지 수신
    → chrome.tabs.captureVisibleTab() 실행 (현재 화면 스크린샷)
    → Canvas로 클릭 위치에 빨간 원 + 번호 그리기
    → IndexedDB에 저장 (이미지 blob + 메타데이터)
    → sidepanel에 알림 (새 단계 추가됨)

[4] 사이드 패널 업데이트
    sidepanel.js: 새 단계를 목록에 추가
    → 사용자가 설명 입력

[5] 녹화 중지 → 미리보기/내보내기
```

---

## 4. Data Model

### 4.1 IndexedDB 스키마 (Dexie.js)

```javascript
// lib/db.js
const db = new Dexie('StepHowDB');

db.version(1).stores({
  // 매뉴얼 목록
  manuals: '++id, title, createdAt, updatedAt',

  // 각 단계 (매뉴얼에 속함)
  steps: '++id, manualId, order, parentId, branchCondition',

  // 설정
  settings: 'key'
});
```

### 4.2 데이터 구조

```javascript
// 매뉴얼 (Manual)
{
  id: 1,                          // 자동 증가
  title: "경비 신청 매뉴얼",        // 매뉴얼 제목
  description: "",                 // 매뉴얼 설명 (선택)
  createdAt: "2026-03-18T10:00:00Z",
  updatedAt: "2026-03-18T10:30:00Z",
  stepCount: 8                     // 총 단계 수
}

// 단계 (Step)
{
  id: 1,                          // 자동 증가
  manualId: 1,                    // 소속 매뉴얼 ID
  order: 1,                       // 표시 순서

  // 캡처 데이터
  screenshot: Blob,               // 스크린샷 이미지 (JPEG)
  screenshotWithMarker: Blob,     // 클릭 마커가 표시된 이미지
  pageUrl: "https://erp.company.com/expense",
  pageTitle: "경비 신청",

  // 클릭 정보
  clickX: 450,                    // 클릭 X 좌표 (뷰포트 기준)
  clickY: 320,                    // 클릭 Y 좌표
  elementTag: "button",           // 클릭한 HTML 태그
  elementText: "신청하기",         // 요소의 텍스트
  elementId: "btn-submit",        // 요소의 ID
  elementClassName: "btn-primary", // 요소의 클래스

  // 사용자 입력
  description: "경비 신청 버튼을 클릭합니다",  // 사용자가 작성한 설명

  // 분기 흐름 (차별화 기능)
  isBranch: false,                // 분기 단계 여부
  branchCondition: "",            // 분기 조건 텍스트 ("결재권자가 본인일 때")
  parentId: null,                 // 분기의 부모 단계 ID (null이면 일반 단계)
  branchLabel: "",                // 분기 레이블 ("예" / "아니오")

  createdAt: "2026-03-18T10:05:00Z"
}

// 설정 (Settings)
{
  key: "captureQuality",
  value: 80                       // JPEG 품질 (0-100)
}
{
  key: "gifSpeed",
  value: 2000                     // GIF 프레임 속도 (ms)
}
```

### 4.3 분기 흐름 데이터 구조

```
일반 흐름:  Step1 → Step2 → Step3 → Step4

분기 흐름:  Step1 → Step2 → [분기]
                              ├─ 조건A → Step3A → Step4A ─┐
                              └─ 조건B → Step3B ───────────┤
                                                           └→ Step5 (합류)

데이터로 표현:
┌────────────────────────────────────────────────────────┐
│ Step2: isBranch=true, branchCondition="결재권자 확인"    │
│                                                         │
│ Step3A: parentId=Step2.id, branchLabel="본인일 때"       │
│ Step4A: parentId=Step2.id, branchLabel="본인일 때"       │
│                                                         │
│ Step3B: parentId=Step2.id, branchLabel="타인일 때"       │
│                                                         │
│ Step5: parentId=null (합류점, 일반 단계로 복귀)           │
└────────────────────────────────────────────────────────┘
```

---

## 5. UI/UX Design

### 5.1 사이드 패널 (Side Panel) - 메인 화면

```
┌─── StepHow Clone ──────────────────┐
│                                     │
│  📋 새 매뉴얼        [⚙️ 설정]      │
│  ─────────────────────────────────  │
│                                     │
│  ┌─────────────────────────────┐   │
│  │  ● REC  녹화 중...  [⏹ 중지] │   │
│  └─────────────────────────────┘   │
│                                     │
│  ─── 캡처된 단계 (3) ────────────   │
│                                     │
│  ┌─ Step 1 ────────────────────┐   │
│  │ 🖼️ [스크린샷 썸네일]          │   │
│  │ 📍 "로그인" 버튼 클릭          │   │
│  │ ✏️ 로그인 페이지에서 로그인     │   │
│  │    버튼을 클릭합니다           │   │
│  │           [🔀 분기] [🗑️ 삭제] │   │
│  └─────────────────────────────┘   │
│                                     │
│  ┌─ Step 2 ────────────────────┐   │
│  │ 🖼️ [스크린샷 썸네일]          │   │
│  │ 📍 "경비 신청" 메뉴 클릭       │   │
│  │ ✏️ 설명을 입력하세요...        │   │
│  │           [🔀 분기] [🗑️ 삭제] │   │
│  └─────────────────────────────┘   │
│                                     │
│  ┌─ Step 3 ────────────────────┐   │
│  │ 🖼️ [스크린샷 썸네일]          │   │
│  │ 📍 "금액" 입력필드 클릭        │   │
│  │ ✏️ 설명을 입력하세요...        │   │
│  │           [🔀 분기] [🗑️ 삭제] │   │
│  └─────────────────────────────┘   │
│                                     │
│  ─────────────────────────────────  │
│  [👁️ 미리보기]  [📥 내보내기 ▼]    │
│                  ├ HTML             │
│                  ├ PDF              │
│                  ├ PPT              │
│                  └ GIF              │
└─────────────────────────────────────┘
```

### 5.2 분기 설정 UI

```
┌─── 분기 조건 설정 ─────────────────┐
│                                     │
│  이 단계에서 분기가 발생합니다       │
│                                     │
│  분기 조건:                          │
│  ┌─────────────────────────────┐   │
│  │ 결재권자가 본인인 경우          │   │
│  └─────────────────────────────┘   │
│                                     │
│  경로 A: [본인일 때        ]        │
│  경로 B: [타인일 때        ]        │
│                                     │
│  💡 분기 후 각 경로에서 녹화를       │
│     이어가세요. 합류점에서 분기를    │
│     종료합니다.                      │
│                                     │
│  [취소]            [분기 시작]       │
└─────────────────────────────────────┘
```

### 5.3 매뉴얼 미리보기 (Viewer)

```
┌─────────────────────────────────────────────────────────┐
│  📖 경비 신청 매뉴얼                    [📥 내보내기 ▼] │
│  작성일: 2026-03-18 | 총 5단계                          │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  Step 1                                                  │
│  ┌────────────────────────────────────────────┐          │
│  │                                            │          │
│  │         [스크린샷 이미지]                    │          │
│  │              ①  ← 클릭 위치 표시            │          │
│  │                                            │          │
│  └────────────────────────────────────────────┘          │
│  📍 "로그인" 버튼을 클릭합니다                            │
│  ─────────────────────────────────────────────           │
│                                                          │
│  Step 2                                                  │
│  ┌────────────────────────────────────────────┐          │
│  │                                            │          │
│  │         [스크린샷 이미지]                    │          │
│  │                       ②                     │          │
│  │                                            │          │
│  └────────────────────────────────────────────┘          │
│  📍 좌측 메뉴에서 "경비 신청"을 클릭합니다                │
│  ─────────────────────────────────────────────           │
│                                                          │
│  ⚡ 분기: 결재권자가 본인인 경우                          │
│  ┌─── 경로 A: 본인일 때 ───┐┌── 경로 B: 타인일 때 ──┐   │
│  │ Step 3A                  ││ Step 3B               │   │
│  │ [스크린샷]               ││ [스크린샷]             │   │
│  │ 바로 승인 클릭           ││ 상위 결재자 선택       │   │
│  └──────────────────────────┘└───────────────────────┘   │
│                                                          │
│  Step 4 (합류)                                           │
│  ┌────────────────────────────────────────────┐          │
│  │         [스크린샷 이미지]                    │          │
│  └────────────────────────────────────────────┘          │
│  📍 "완료" 버튼을 클릭하여 신청을 마칩니다                │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### 5.4 User Flow

```
[확장 아이콘 클릭]
    ↓
[사이드 패널 열림] → [🔴 녹화 시작 클릭]
    ↓
[사내 시스템에서 업무 수행 (클릭하면 자동 캡처)]
    ↓
[⏹ 녹화 중지]
    ↓
[각 단계에 설명 입력 / 필요시 분기 설정]
    ↓
[👁️ 미리보기로 확인]
    ↓
[📥 내보내기 (HTML / PDF / PPT / GIF)]
```

---

## 6. 핵심 기능 상세 설계

### 6.1 클릭 캡처 (content.js)

```javascript
// content.js에서 수집하는 정보
{
  type: 'CLICK_EVENT',
  data: {
    // 클릭 좌표 (뷰포트 기준)
    x: event.clientX,
    y: event.clientY,

    // 페이지 정보
    pageUrl: location.href,
    pageTitle: document.title,

    // 클릭한 요소 정보 (자동 추출)
    element: {
      tag: element.tagName,          // "BUTTON"
      text: element.innerText,       // "신청하기"
      id: element.id,                // "btn-submit"
      className: element.className,  // "btn btn-primary"
      ariaLabel: element.getAttribute('aria-label'),
      placeholder: element.placeholder,
      type: element.type,            // "submit"
      // 자동 설명 생성 힌트
      autoDescription: generateAutoDescription(element)
    },

    // 뷰포트 크기 (좌표 → 이미지 변환용)
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio
    },

    timestamp: Date.now()
  }
}
```

### 6.2 자동 설명 생성 (AI 없이)

```javascript
// 클릭한 요소의 정보를 기반으로 기본 설명을 자동 생성
function generateAutoDescription(element) {
  const tag = element.tagName.toLowerCase();
  const text = element.innerText?.trim() ||
               element.placeholder ||
               element.getAttribute('aria-label') ||
               element.value || '';

  // 태그별 설명 패턴
  const patterns = {
    button: `"${text}" 버튼을 클릭합니다`,
    a:      `"${text}" 링크를 클릭합니다`,
    input:  `"${text || element.name}" 입력란을 클릭합니다`,
    select: `"${text}" 드롭다운을 클릭합니다`,
    textarea: `"${text || element.name}" 텍스트 영역을 클릭합니다`,
    img:    `이미지를 클릭합니다`,
    li:     `"${text}" 항목을 클릭합니다`,
    td:     `테이블 셀을 클릭합니다`,
  };

  return patterns[tag] || `"${text || tag}" 요소를 클릭합니다`;
}
```

### 6.3 스크린샷 + 클릭 마커 (capture.js)

```javascript
// background.js에서 호출
async function captureWithMarker(clickData) {
  // 1. 현재 탭 캡처
  const dataUrl = await chrome.tabs.captureVisibleTab(null, {
    format: 'jpeg',
    quality: 80
  });

  // 2. OffscreenCanvas로 클릭 위치에 마커 그리기
  //    (Service Worker에서는 OffscreenCanvas 사용)
  const img = await loadImage(dataUrl);
  const canvas = new OffscreenCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');

  // 원본 이미지 그리기
  ctx.drawImage(img, 0, 0);

  // 클릭 위치에 빨간 원 + 번호 그리기
  const ratio = window.devicePixelRatio || 1;
  const markerX = clickData.x * ratio;
  const markerY = clickData.y * ratio;
  const stepNumber = clickData.stepNumber;

  // 빨간 원
  ctx.beginPath();
  ctx.arc(markerX, markerY, 20, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 0, 0, 0.8)';
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 3;
  ctx.stroke();

  // 번호 텍스트
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 16px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(stepNumber), markerX, markerY);

  // 3. Blob으로 변환
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
  return blob;
}
```

### 6.4 내보내기 설계

#### HTML 내보내기

```javascript
// 독립 실행 가능한 단일 HTML 파일 생성
// 이미지는 Base64로 인라인 삽입
function exportToHTML(manual, steps) {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>${manual.title}</title>
      <style>/* 내장 스타일 */</style>
    </head>
    <body>
      <h1>${manual.title}</h1>
      ${steps.map(step => `
        <div class="step">
          <h2>Step ${step.order}</h2>
          <img src="data:image/jpeg;base64,${blobToBase64(step.screenshotWithMarker)}">
          <p>${step.description}</p>
        </div>
      `).join('')}
    </body>
    </html>
  `;
  downloadFile(html, `${manual.title}.html`, 'text/html');
}
```

#### PDF 내보내기

```javascript
// jsPDF + html2canvas
// 각 단계를 A4 페이지에 맞춰 배치
async function exportToPDF(manual, steps) {
  const doc = new jsPDF('p', 'mm', 'a4');

  // 표지
  doc.setFontSize(24);
  doc.text(manual.title, 105, 60, { align: 'center' });

  for (const step of steps) {
    doc.addPage();
    doc.setFontSize(16);
    doc.text(`Step ${step.order}`, 15, 20);

    // 스크린샷 이미지 추가 (가로 맞춤)
    const imgData = await blobToDataUrl(step.screenshotWithMarker);
    doc.addImage(imgData, 'JPEG', 15, 30, 180, 100);

    // 설명 텍스트
    doc.setFontSize(12);
    doc.text(step.description, 15, 140, { maxWidth: 180 });
  }

  doc.save(`${manual.title}.pdf`);
}
```

#### PPT 내보내기

```javascript
// PptxGenJS
// 슬라이드 1장 = 1단계
async function exportToPPTX(manual, steps) {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';

  // 표지 슬라이드
  const titleSlide = pptx.addSlide();
  titleSlide.addText(manual.title, {
    x: 1, y: 2, w: 8, h: 2, fontSize: 36, align: 'center'
  });

  for (const step of steps) {
    const slide = pptx.addSlide();

    // 단계 번호
    slide.addText(`Step ${step.order}`, {
      x: 0.5, y: 0.3, fontSize: 20, bold: true
    });

    // 스크린샷
    const imgData = await blobToBase64(step.screenshotWithMarker);
    slide.addImage({
      data: `data:image/jpeg;base64,${imgData}`,
      x: 0.5, y: 1, w: 6, h: 3.5
    });

    // 설명
    slide.addText(step.description, {
      x: 0.5, y: 4.8, w: 9, fontSize: 14
    });
  }

  pptx.writeFile({ fileName: `${manual.title}.pptx` });
}
```

#### GIF 내보내기

```javascript
// gif.js
// 캡처 이미지들을 슬라이드쇼 GIF로 변환
async function exportToGIF(manual, steps, options = {}) {
  const {
    delay = 2000,      // 프레임 간격 (ms)
    width = 800,       // GIF 너비
    showNumber = true  // 단계 번호 표시
  } = options;

  const gif = new GIF({
    workers: 2,
    quality: 10,
    width: width,
    height: Math.round(width * 0.6) // 16:10 비율
  });

  for (const step of steps) {
    const canvas = await renderStepToCanvas(step, width, showNumber);
    gif.addFrame(canvas, { delay });
  }

  gif.on('finished', (blob) => {
    downloadFile(blob, `${manual.title}.gif`, 'image/gif');
  });

  gif.render();
}
```

---

## 7. manifest.json 설계

```json
{
  "manifest_version": 3,
  "name": "StepHow Clone - 매뉴얼 자동 생성",
  "version": "0.1.0",
  "description": "클릭만으로 업무 매뉴얼을 자동 생성하는 도구",

  "permissions": [
    "activeTab",
    "sidePanel",
    "storage",
    "tabs"
  ],

  "host_permissions": [
    "<all_urls>"
  ],

  "background": {
    "service_worker": "background.js",
    "type": "module"
  },

  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content.js"],
      "css": ["content.css"],
      "run_at": "document_idle"
    }
  ],

  "side_panel": {
    "default_path": "sidepanel/sidepanel.html"
  },

  "action": {
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    },
    "default_title": "StepHow Clone"
  },

  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  },

  "web_accessible_resources": [
    {
      "resources": ["vendor/*"],
      "matches": ["<all_urls>"]
    }
  ]
}
```

---

## 8. 보안 고려사항

- [x] 모든 데이터 로컬 저장 (IndexedDB), 외부 전송 없음
- [x] `host_permissions`은 캡처 목적으로만 사용
- [x] Content Script는 클릭 좌표/요소 정보만 수집 (입력값, 비밀번호 수집 안 함)
- [x] 내보낸 파일에 민감정보 포함 주의 안내 UI 표시

---

## 9. 구현 순서

| 순서 | 파일 | 기능 | 의존성 |
|:----:|------|------|--------|
| 1 | `manifest.json` | 확장 프로그램 설정 | 없음 |
| 2 | `lib/db.js` | IndexedDB (Dexie.js) 초기화 | vendor/dexie |
| 3 | `background.js` | Service Worker + 녹화 상태 관리 | db.js |
| 4 | `content.js` + `content.css` | 클릭 감지 + 시각 피드백 | 없음 |
| 5 | `lib/capture.js` | 스크린샷 + 클릭 마커 그리기 | Canvas API |
| 6 | `sidepanel/*` | 사이드 패널 UI | db.js, Sortable |
| 7 | `viewer/*` | 매뉴얼 미리보기 | db.js |
| 8 | `lib/export-html.js` | HTML 내보내기 | 없음 |
| 9 | `lib/export-pdf.js` | PDF 내보내기 | jsPDF, html2canvas |
| 10 | `lib/export-pptx.js` | PPT 내보내기 | PptxGenJS |
| 11 | `lib/branch.js` | 분기 흐름 데이터 관리 | db.js |
| 12 | 분기 UI (sidepanel + viewer) | 분기 설정/표시 | branch.js |
| 13 | `lib/export-gif.js` | GIF 내보내기 | gif.js |

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-03-18 | Initial draft | heomuyeong |
