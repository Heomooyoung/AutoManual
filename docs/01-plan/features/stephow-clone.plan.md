# StepHow Clone - 매뉴얼 자동 생성 프로그램 기획서

> **Summary**: 웹 브라우저에서 사용자의 클릭/입력 이벤트를 자동 캡처하여 단계별 매뉴얼을 생성하는 Chrome 확장 프로그램
>
> **Project**: 매뉴얼 생성 프로그램 (StepHow Clone)
> **Version**: 0.1.0
> **Author**: heomuyeong
> **Date**: 2026-03-18
> **Status**: Draft

---

## Executive Summary

| Perspective | Content |
|-------------|---------|
| **Problem** | 사내 시스템 업무 매뉴얼을 만들 때 스크린샷을 일일이 찍고, 편집하고, 문서에 붙여넣는 과정이 너무 번거롭고 시간이 오래 걸림 |
| **Solution** | Chrome 확장 프로그램으로 클릭 시 자동 캡처 + 클릭 위치 표시 + **조건 분기 흐름** + **GIF 내보내기**로 차별화된 매뉴얼 생성 |
| **Function/UX Effect** | 녹화 버튼 하나로 업무 흐름 자동 기록. 분기 흐름으로 실제 업무의 조건부 프로세스 표현 가능. GIF로 간편 공유 |
| **Core Value** | 스텝하우보다 가볍고, "분기 흐름 + GIF 내보내기"라는 경쟁사에 없는 기능을 갖춘 오픈소스 매뉴얼 도구 |

---

## 1. Overview

### 1.1 Purpose

사내 시스템(ERP, 그룹웨어 등)의 업무 프로세스를 문서화할 때, 수작업으로 스크린샷을 찍고 편집하는 비효율을 해결합니다. 브라우저에서 실제 업무를 수행하기만 하면 자동으로 매뉴얼이 생성되는 프로그램을 만듭니다.

### 1.2 Background

- **스텝하우(StepHow)** 같은 상용 프로그램이 존재하지만, 유료이고 사내망에서 사용 시 보안 우려가 있음
- 직접 만들면 사내 환경에 맞게 커스터마이징 가능하고, 데이터가 외부로 나가지 않아 보안에 유리
- 가볍고 핵심 기능에 집중한 프로그램을 목표로 함

### 1.3 벤치마킹 대상

- **스텝하우(StepHow)**: AI 기반 매뉴얼 자동 생성, Chrome 확장 + 데스크톱 앱
- **Scribe**: 자동 프로세스 문서화 도구
- **Tango**: 워크플로우 캡처 및 가이드 생성

---

## 2. Scope

### 2.1 In Scope (MVP - 1차 개발)

- [ ] Chrome 확장 프로그램 기본 구조 (Manifest V3)
- [ ] 녹화 시작/중지 기능
- [ ] 클릭 이벤트 감지 및 자동 스크린샷 캡처
- [ ] 클릭 위치에 빨간 원(번호) 표시
- [ ] 캡처된 단계 목록 보기 (사이드패널)
- [ ] 각 단계에 설명 텍스트 입력/수정
- [ ] 전체 매뉴얼 미리보기 페이지
- [ ] HTML로 내보내기 (저장)
- [ ] **[차별화] 분기 흐름 (조건부 단계)** — "만약 A이면 → B, 아니면 → C" 표현
- [ ] **[차별화] GIF 애니메이션 내보내기** — 캡처 단계를 슬라이드쇼 GIF로 변환
- [ ] PDF 내보내기 (jsPDF + html2canvas, 무료 오픈소스)
- [ ] PPT 내보내기 (PptxGenJS, 무료 오픈소스)

### 2.2 Out of Scope (향후 확장)

- 키보드 입력 감지 및 기록
- 이미지 편집 도구 (화살표, 하이라이트, 모자이크)
- 민감정보 자동 블러 (이메일, 전화번호 등 자동 모자이크)
- 매뉴얼 변경 감지 (UI 변경 시 업데이트 알림)
- 팀 공유 및 협업 기능
- AI 기반 설명 자동 생성
- 데스크톱 앱 버전

---

## 3. Requirements

### 3.1 Functional Requirements

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-01 | 녹화 시작/중지 토글 버튼 | High | Pending |
| FR-02 | 클릭 이벤트 발생 시 현재 탭 스크린샷 자동 캡처 | High | Pending |
| FR-03 | 캡처된 스크린샷에 클릭 위치 빨간 원 + 번호 표시 | High | Pending |
| FR-04 | 클릭한 요소 정보 자동 추출 (버튼명, 입력필드명 등) | Medium | Pending |
| FR-05 | 각 단계별 설명 텍스트 입력/수정 기능 | High | Pending |
| FR-06 | 단계 순서 변경 (드래그&드롭) | Medium | Pending |
| FR-07 | 불필요한 단계 삭제 | High | Pending |
| FR-08 | 전체 매뉴얼 미리보기 | High | Pending |
| FR-09 | HTML 파일로 내보내기 | High | Pending |
| FR-10 | 캡처 데이터 로컬 저장 (IndexedDB) | High | Pending |
| FR-11 | **[차별화]** 분기 흐름 — 단계에 조건 분기 추가 ("만약 A이면 → Step X, 아니면 → Step Y") | High | Pending |
| FR-12 | **[차별화]** 분기 흐름 미리보기 — 플로우차트 형태로 분기 시각화 | Medium | Pending |
| FR-13 | **[차별화]** GIF 애니메이션 내보내기 — 캡처된 단계를 자동 슬라이드쇼 GIF로 변환 | High | Pending |
| FR-14 | **[차별화]** GIF 설정 — 속도(초/장), 크기, 단계번호 표시 옵션 | Medium | Pending |
| FR-15 | PDF 내보내기 — jsPDF + html2canvas로 매뉴얼을 PDF 파일로 저장 | High | Pending |
| FR-16 | PPT 내보내기 — PptxGenJS로 매뉴얼을 .pptx 파일로 저장 (슬라이드 1장 = 1단계) | High | Pending |

### 3.2 Non-Functional Requirements

| Category | Criteria | Measurement Method |
|----------|----------|-------------------|
| Performance | 클릭 후 캡처까지 500ms 이내 | 수동 테스트 |
| 용량 | 확장 프로그램 크기 1MB 이하 | 빌드 후 확인 |
| 호환성 | Chrome 120+ 지원 | 브라우저 테스트 |
| 보안 | 캡처 데이터 로컬에만 저장, 외부 전송 없음 | 코드 리뷰 |

---

## 4. Success Criteria

### 4.1 Definition of Done

- [ ] Chrome 확장 프로그램 설치 가능
- [ ] 녹화 시작 → 웹사이트에서 클릭 → 자동 캡처 → 녹화 중지 흐름 동작
- [ ] 캡처된 단계에 설명 추가 가능
- [ ] HTML로 내보내기 가능
- [ ] 실제 사내 시스템에서 매뉴얼 생성 테스트 완료

### 4.2 Quality Criteria

- [ ] 주요 기능 모두 동작 (수동 테스트)
- [ ] Chrome 개발자 도구에서 에러 없음
- [ ] 10단계 이상의 매뉴얼을 무리 없이 생성 가능

---

## 5. Risks and Mitigation

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Chrome 확장 API 학습 곡선 | Medium | High | 단계별로 하나씩 배워가며 구현, Claude Code 활용 |
| 일부 사이트에서 Content Script 차단 | Medium | Medium | chrome.tabs.captureVisibleTab()으로 탭 전체 캡처 방식 사용 |
| 캡처 이미지 용량이 커져 성능 저하 | Medium | Medium | 이미지를 JPEG로 압축, 품질 80%로 설정 |
| iframe 내부 클릭 감지 불가 | Low | Medium | MVP에서는 최상위 프레임만 지원, 향후 개선 |

---

## 6. Architecture Considerations

### 6.1 Project Level Selection

| Level | Characteristics | Recommended For | Selected |
|-------|-----------------|-----------------|:--------:|
| **Starter** | Simple structure | Chrome 확장 프로그램 (HTML/CSS/JS) | **✅** |
| Dynamic | Feature-based modules | - | ☐ |
| Enterprise | Strict layer separation | - | ☐ |

> **선택 이유**: Chrome 확장 프로그램은 순수 HTML/CSS/JavaScript로 개발하며, 별도 프레임워크가 필요 없어 Starter 레벨이 적합합니다. 입문자도 쉽게 이해할 수 있는 구조입니다.

### 6.2 Key Architectural Decisions

| Decision | Options | Selected | Rationale |
|----------|---------|----------|-----------|
| 플랫폼 | Chrome Extension / Web App / Desktop | **Chrome Extension** | 브라우저 이벤트 감지 + 화면 캡처에 최적 |
| Manifest | V2 / V3 | **Manifest V3** | Chrome 최신 표준, V2는 지원 종료 예정 |
| 데이터 저장 | localStorage / IndexedDB / chrome.storage | **IndexedDB** | 이미지 등 대용량 바이너리 저장에 적합 |
| UI 패널 | Popup / Side Panel / New Tab | **Side Panel** | 녹화 중 단계 확인에 편리, Chrome 114+지원 |
| 이미지 형식 | PNG / JPEG / WebP | **JPEG 80%** | 용량 절감, 충분한 품질 |
| 스타일링 | 순수 CSS / Tailwind | **순수 CSS** | 빌드 과정 불필요, 입문자에게 적합 |

### 6.3 Chrome Extension 구조

```
stephow-extension/
├── manifest.json              # 확장 프로그램 설정 파일
├── background.js              # Service Worker (백그라운드 로직)
├── content.js                 # Content Script (웹페이지에 주입)
├── sidepanel/
│   ├── sidepanel.html         # 사이드 패널 UI
│   ├── sidepanel.css          # 사이드 패널 스타일
│   └── sidepanel.js           # 사이드 패널 로직
├── viewer/
│   ├── viewer.html            # 매뉴얼 미리보기/내보내기 페이지
│   ├── viewer.css             # 미리보기 스타일
│   └── viewer.js              # 미리보기 로직
├── lib/
│   ├── db.js                  # IndexedDB 헬퍼
│   └── export.js              # HTML 내보내기 로직
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── styles/
    └── content.css            # 클릭 표시용 스타일 (웹페이지 주입)
```

### 6.4 데이터 흐름

```
[사용자 클릭]
    ↓ (content.js가 이벤트 감지)
[클릭 위치 + 요소 정보 수집]
    ↓ (chrome.runtime.sendMessage)
[background.js가 메시지 수신]
    ↓ (chrome.tabs.captureVisibleTab)
[현재 화면 스크린샷 캡처]
    ↓ (Canvas로 클릭 위치에 빨간 원 그리기)
[스크린샷 + 메타데이터 저장]
    ↓ (IndexedDB에 저장)
[사이드 패널에 새 단계 표시]
    ↓ (사용자가 설명 입력)
[매뉴얼 완성 → HTML 내보내기]
```

---

## 7. Convention Prerequisites

### 7.1 Existing Project Conventions

- [ ] `CLAUDE.md` has coding conventions section
- [ ] ESLint configuration → 미사용 (순수 JS)
- [ ] Prettier configuration → 미사용

### 7.2 Conventions to Define

| Category | Rule | Priority |
|----------|------|:--------:|
| **Naming** | 파일명: kebab-case, 변수/함수: camelCase | High |
| **Folder structure** | 위 6.3 구조를 따름 | High |
| **주석** | 한국어 주석 허용, 각 함수에 간단한 설명 | Medium |

### 7.3 Environment Variables

해당 없음 — Chrome 확장 프로그램은 환경 변수를 사용하지 않습니다.

---

## 8. 개발 단계 (Milestone)

### Phase 1: 기본 뼈대 (Day 1)
1. [ ] manifest.json 작성
2. [ ] background.js 기본 구조
3. [ ] 확장 프로그램 아이콘 클릭 → 녹화 시작/중지
4. [ ] Side Panel 기본 UI

### Phase 2: 자동 캡처 (Day 2)
5. [ ] content.js - 클릭 이벤트 감지
6. [ ] background.js - 탭 스크린샷 캡처
7. [ ] 캡처 이미지에 클릭 위치 표시 (Canvas)
8. [ ] IndexedDB에 데이터 저장

### Phase 3: 편집 & 보기 (Day 3)
9. [ ] Side Panel에 캡처된 단계 목록 표시
10. [ ] 각 단계 설명 입력/수정
11. [ ] 단계 삭제 기능
12. [ ] 매뉴얼 미리보기 페이지

### Phase 4: 내보내기 (Day 4-5)
13. [ ] HTML 파일 내보내기
14. [ ] PDF 내보내기 (jsPDF + html2canvas)
15. [ ] PPT 내보내기 (PptxGenJS, 슬라이드 1장 = 1단계)
16. [ ] 내보내기 옵션 UI (형식 선택)

### Phase 5: 차별화 기능 - 분기 흐름 (Day 6)
15. [ ] 단계에 "조건 분기" 추가 UI (조건 입력 + 분기 경로 설정)
16. [ ] 분기 데이터 구조 설계 및 저장
17. [ ] 미리보기에서 분기를 플로우차트 형태로 시각화
18. [ ] HTML 내보내기에 분기 흐름 반영

### Phase 6: 차별화 기능 - GIF 내보내기 (Day 7)
21. [ ] gif.js 라이브러리 연동 (클라이언트 사이드 GIF 생성)
22. [ ] 캡처 이미지들을 슬라이드쇼 GIF로 변환
23. [ ] GIF 설정 UI (속도, 크기, 단계번호 표시)
24. [ ] GIF 다운로드 기능

### Phase 7: 마무리 (Day 8)
25. [ ] 전체 통합 테스트
26. [ ] 버그 수정 및 UI 다듬기
27. [ ] 아이콘 디자인 마무리

---

## 9. Next Steps

1. [ ] 이 기획서 검토 및 확정
2. [ ] Design 문서 작성 (`/pdca design stephow-clone`)
3. [ ] Phase 1부터 구현 시작

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-03-18 | Initial draft | heomuyeong |
