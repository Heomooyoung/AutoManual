// ========================================
// content.js — Content Script
// 역할: 웹페이지에서 클릭 이벤트 감지
// ========================================

// 중복 주입 방지
if (!window.__autoManualContentLoaded) {
window.__autoManualContentLoaded = true;

// 녹화 중인지 확인
let isRecording = false;
let clickFeedbackTimeout = null;

// 녹화 상태를 주기적으로 확인
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'RECORDING_STATE_CHANGED') {
    const wasRecording = isRecording;
    isRecording = message.isRecording;
    // 녹화 시작 시 화면 전체에 큰 글자 표시
    if (!wasRecording && isRecording) {
      showFullscreenFlash('녹화를 시작합니다');
    }
  }
});

function showFullscreenFlash(text) {
  // 최상위 프레임에서만 표시
  if (window !== window.top) return;
  const el = document.createElement('div');
  el.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    display: flex; align-items: center; justify-content: center;
    background: rgba(0,0,0,0.6); z-index: 2147483647;
    pointer-events: none; opacity: 1;
    transition: opacity 0.5s ease;
  `;
  const inner = document.createElement('div');
  inner.textContent = text;
  inner.style.cssText = `
    color: #ffffff; font-size: 72px; font-weight: 900;
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    text-shadow: 0 4px 20px rgba(0,0,0,0.5);
    letter-spacing: 4px;
    animation: am-flash-scale 0.4s ease;
  `;
  el.appendChild(inner);

  const style = document.createElement('style');
  style.textContent = `
    @keyframes am-flash-scale {
      0% { transform: scale(0.5); opacity: 0; }
      60% { transform: scale(1.05); }
      100% { transform: scale(1); opacity: 1; }
    }
  `;
  el.appendChild(style);
  document.body.appendChild(el);

  setTimeout(() => { el.style.opacity = '0'; }, 800);
  setTimeout(() => { el.remove(); }, 1300);
}

// 초기 상태 확인 (새 탭/팝업 창에서도 녹화 상태 동기화)
function syncRecordingStatus() {
  chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
    if (chrome.runtime.lastError) return; // 확장이 비활성 상태면 무시
    if (response) {
      isRecording = response.isRecording;
    }
  });
}

// 페이지 로드 시 즉시 + 약간 지연 후 재확인 (팝업 타이밍 대응)
syncRecordingStatus();
setTimeout(syncRecordingStatus, 500);

// 페이지가 포커스를 받을 때마다 상태 재확인 (팝업 전환 대응)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    syncRecordingStatus();
  }
});
window.addEventListener('focus', syncRecordingStatus);

// 클릭한 요소에서 자동 설명 생성
function generateAutoDescription(element) {
  const tag = element.tagName.toLowerCase();
  const text = (
    element.innerText?.trim().substring(0, 30) ||
    element.placeholder ||
    element.getAttribute('aria-label') ||
    element.getAttribute('title') ||
    element.value ||
    ''
  );

  const patterns = {
    button: `"${text}" 버튼을 클릭합니다`,
    a: `"${text}" 링크를 클릭합니다`,
    input: element.type === 'password'
      ? `비밀번호 입력란으로 이동합니다`
      : `"${text || element.name || element.type || '입력'}" 입력란을 클릭합니다`,
    select: `"${text}" 드롭다운을 클릭합니다`,
    textarea: `"${text || '텍스트'}" 영역을 클릭합니다`,
    img: `이미지를 클릭합니다`,
    li: `"${text}" 항목을 선택합니다`,
    td: `테이블 셀을 클릭합니다`,
    th: `테이블 헤더를 클릭합니다`,
    label: `"${text}" 라벨을 클릭합니다`,
    span: `"${text}" 영역을 클릭합니다`,
    div: `"${text}" 영역을 클릭합니다`,
    h1: `"${text}" 제목을 클릭합니다`,
    h2: `"${text}" 제목을 클릭합니다`,
    h3: `"${text}" 제목을 클릭합니다`,
    tab: `"${text}" 탭을 클릭합니다`,
  };

  if (text) {
    return patterns[tag] || `"${text}" 요소를 클릭합니다`;
  }
  return `${tag} 요소를 클릭합니다`;
}

// 클릭 시 시각적 피드백 (물결 효과)
function showClickFeedback(x, y) {
  // 기존 피드백 제거
  const existing = document.querySelector('.stephow-click-feedback');
  if (existing) existing.remove();

  const feedback = document.createElement('div');
  feedback.className = 'stephow-click-feedback';
  feedback.style.left = `${x}px`;
  feedback.style.top = `${y}px`;
  document.body.appendChild(feedback);

  // 애니메이션 후 제거
  setTimeout(() => feedback.remove(), 600);
}

// 중복 캡처 방지 (pointerdown + click 동시 발생 대응)
let lastCaptureTime = 0;
const CAPTURE_DEBOUNCE = 200; // 200ms 내 중복 무시
let isAreaSelecting = false; // 영역 선택 중 플래그

// 클릭 데이터를 수집하고 전송하는 핵심 함수
function handleCapture(event) {
  if (isAreaSelecting) return; // 영역 선택 중에는 자동 캡처 무시
  // 녹화 중이 아니면 background에 한번 더 확인 (상태 동기화 누락 대비)
  if (!isRecording) {
    chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
      if (chrome.runtime.lastError) return;
      if (response?.isRecording) {
        isRecording = true;
        // 상태가 갱신됐으면 이번 클릭도 캡처 시도
        doCapture(event);
      }
    });
    return;
  }
  doCapture(event);
}

function doCapture(event) {
  if (!isRecording) return;

  // 중복 캡처 방지
  const now = Date.now();
  if (now - lastCaptureTime < CAPTURE_DEBOUNCE) return;
  lastCaptureTime = now;

  // 확장 프로그램 자체 UI 클릭은 무시
  if (event.target.closest('.stephow-click-feedback')) return;

  // 클릭한 요소 — 의미 있는 UI 요소까지 올라가서 찾기
  const element = findMeaningfulElement(event.target);

  // 시각적 피드백
  showClickFeedback(event.pageX, event.pageY);

  // 클릭한 요소의 영역(Bounding Rect) 수집
  const rect = element.getBoundingClientRect();

  // iframe 안이면 최상위 윈도우 기준 좌표 보정
  let offsetX = 0;
  let offsetY = 0;
  let currentWindow = window;
  try {
    while (currentWindow !== currentWindow.top) {
      const frameEl = currentWindow.frameElement;
      if (frameEl) {
        const frameRect = frameEl.getBoundingClientRect();
        offsetX += frameRect.x;
        offsetY += frameRect.y;
      }
      currentWindow = currentWindow.parent;
    }
  } catch (e) {
    // cross-origin iframe이면 좌표 보정 불가 → 그냥 진행
  }

  // 클릭 데이터 수집
  const clickData = {
    x: event.clientX + offsetX,
    y: event.clientY + offsetY,
    pageX: event.pageX,
    pageY: event.pageY,
    pageUrl: location.href,
    pageTitle: document.title || (() => { try { return window.top?.document?.title || ''; } catch(e) { return ''; } })(),
    // 클릭한 요소의 영역 정보 (라운드 사각형 표시용)
    elementRect: {
      x: rect.x + offsetX,
      y: rect.y + offsetY,
      width: rect.width,
      height: rect.height
    },
    element: {
      tag: element.tagName,
      text: (element.innerText || '').trim().substring(0, 50),
      id: element.id || '',
      className: (typeof element.className === 'string' ? element.className : '').substring(0, 100),
      ariaLabel: element.getAttribute('aria-label') || '',
      placeholder: element.placeholder || '',
      type: element.type || '',
      name: element.name || '',
      autoDescription: generateAutoDescription(element)
    },
    viewport: {
      // iframe 안이면 최상위 윈도우 크기를 사용해야 캡처 이미지와 좌표가 맞음
      width: (() => { try { return window.top?.innerWidth || window.innerWidth; } catch(e) { return window.innerWidth; } })(),
      height: (() => { try { return window.top?.innerHeight || window.innerHeight; } catch(e) { return window.innerHeight; } })(),
      devicePixelRatio: window.devicePixelRatio || 1
    },
    timestamp: now
  };

  // background.js로 전송
  chrome.runtime.sendMessage({
    type: 'CLICK_EVENT',
    data: clickData
  }).then((response) => {
    if (response?.captured) {
      console.log(`[DX-AutoManual] Step ${response.stepNumber} 캡처 완료`);
    }
  }).catch(() => {
    // 확장 컨텍스트가 무효화된 경우 무시
  });
}

// === 이벤트 리스너 등록 ===
// 1) click — 일반적인 클릭 (capture phase)
document.addEventListener('click', handleCapture, true);

// 2) pointerdown — click이 차단되는 요소 대응 (capture phase)
//    일부 UI 프레임워크가 click을 stopPropagation하거나 preventDefault하는 경우
document.addEventListener('pointerdown', (event) => {
  if (!isRecording) return;
  // 마우스 왼쪽 버튼만 (pointerType이 mouse이고 button이 0)
  if (event.button !== 0) return;
  // click 이벤트가 올 수 있으니 약간 지연 후 확인
  // click이 이미 처리됐으면 debounce로 무시됨
  setTimeout(() => handleCapture(event), 100);
}, true);

// 3) Tab/Enter 키로 포커스 이동 감지
//    마지막으로 캡처된 요소를 추적하여 같은 요소 중복 캡처 방지
let lastCapturedElement = null;

document.addEventListener('keydown', (event) => {
  if (!isRecording) return;

  // Tab 키 또는 Enter 키만 처리
  if (event.key !== 'Tab' && event.key !== 'Enter') return;

  // Tab: 포커스 이동 후 새 요소를 캡처해야 하므로 약간 지연
  // Enter: 현재 포커스된 요소의 동작(제출 등)을 캡처
  const delay = event.key === 'Tab' ? 100 : 50;

  setTimeout(() => {
    const focused = document.activeElement;
    if (!focused || focused === document.body) return;

    // 캡처 대상: input, select, textarea, button, a 등
    const capturableTags = new Set([
      'INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'A', 'SUMMARY'
    ]);
    const role = focused.getAttribute('role');
    const hasCapturableRole = role && new Set([
      'button', 'tab', 'menuitem', 'option', 'checkbox', 'radio', 'textbox', 'searchbox', 'link'
    ]).has(role);

    if (!capturableTags.has(focused.tagName) && !hasCapturableRole) return;

    // 같은 요소 중복 캡처 방지
    if (focused === lastCapturedElement) return;
    lastCapturedElement = focused;

    // 가짜 이벤트 객체 생성 (포커스된 요소 중심 좌표 사용)
    const rect = focused.getBoundingClientRect();
    const fakeEvent = {
      clientX: rect.x + rect.width / 2,
      clientY: rect.y + rect.height / 2,
      pageX: rect.x + rect.width / 2 + window.scrollX,
      pageY: rect.y + rect.height / 2 + window.scrollY,
      target: focused
    };

    handleCapture(fakeEvent);
  }, delay);
}, true);

// 클릭 시 lastCapturedElement 초기화 (클릭→Tab 전환 시 중복 방지)
document.addEventListener('click', () => {
  lastCapturedElement = null;
}, true);

// 클릭한 요소에서 의미 있는 UI 요소를 찾기
// 전략: 위로 올라가면서 후보를 수집 → 가장 적절한 크기의 요소 선택
function findMeaningfulElement(el) {
  const meaningfulTags = new Set([
    'BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA',
    'LABEL', 'LI', 'TD', 'TH', 'H1', 'H2', 'H3', 'H4',
    'SUMMARY', 'DETAILS'
  ]);

  const meaningfulRoles = new Set([
    'button', 'link', 'tab', 'menuitem', 'option',
    'checkbox', 'radio', 'switch', 'textbox', 'searchbox',
    'gridcell', 'row', 'listitem', 'treeitem'
  ]);

  // 적절한 크기 범위 (너무 작거나 너무 크면 부적합)
  const MIN_SIZE = 20;   // 최소 20px (아이콘 등)
  const MAX_WIDTH = window.innerWidth * 0.7;  // 화면 70% 이상이면 너무 큼

  // 1단계: 위로 올라가면서 후보 수집
  const candidates = [];
  let current = el;
  let depth = 0;

  while (current && current !== document.body && depth < 8) {
    const rect = current.getBoundingClientRect();
    const tag = current.tagName;
    const role = current.getAttribute('role');
    const style = window.getComputedStyle(current);
    const isVisible = rect.width > 0 && rect.height > 0;

    if (isVisible) {
      let score = 0;

      // 의미 있는 태그이면 높은 점수
      if (meaningfulTags.has(tag)) score += 10;
      // role 속성이 있으면 높은 점수
      if (role && meaningfulRoles.has(role)) score += 10;
      // cursor: pointer이면 클릭 가능한 요소
      if (style.cursor === 'pointer') score += 5;
      // onclick 등 이벤트 핸들러가 있으면
      if (current.onclick || current.getAttribute('onclick')) score += 3;
      // tabindex가 있으면 인터랙티브 요소
      if (current.hasAttribute('tabindex')) score += 3;

      // 크기 기반 점수 — 적절한 크기일수록 높은 점수
      const isGoodWidth = rect.width >= MIN_SIZE && rect.width <= MAX_WIDTH;
      const isGoodHeight = rect.height >= MIN_SIZE && rect.height <= 200;
      if (isGoodWidth && isGoodHeight) score += 5;

      // 너무 작으면 감점
      if (rect.width < MIN_SIZE || rect.height < MIN_SIZE) score -= 5;
      // 너무 크면 감점 (화면 전체를 감싸는 컨테이너 등)
      if (rect.width > MAX_WIDTH) score -= 8;
      if (rect.height > window.innerHeight * 0.5) score -= 8;

      // 깊이가 깊을수록 약간 감점 (원래 클릭한 요소에 가까울수록 유리)
      score -= depth * 0.5;

      if (score > 0) {
        candidates.push({ element: current, score, rect, depth });
      }
    }

    current = current.parentElement;
    depth++;
  }

  // 2단계: 가장 높은 점수의 후보 선택
  if (candidates.length > 0) {
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0].element;
  }

  // 후보가 없으면 원래 요소 반환
  return el;
}

// ─── 선택영역 캡처 오버레이 ───
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'SELECT_AREA') {
    showAreaSelector(message.screenshot, message.viewport);
  }
});

function showAreaSelector(screenshot, viewport) {
  // 최상위 프레임에서만 표시
  if (window !== window.top) return;
  // 이미 존재하면 제거
  const existing = document.getElementById('__autoManualAreaSelector');
  if (existing) existing.remove();
  isAreaSelecting = true;

  const overlay = document.createElement('div');
  overlay.id = '__autoManualAreaSelector';
  overlay.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    z-index: 2147483647; cursor: crosshair;
    background: rgba(0,0,0,0.3);
  `;

  const selBox = document.createElement('div');
  selBox.style.cssText = `
    position: absolute; border: 2px dashed #007aff;
    background: rgba(0,122,255,0.1); display: none;
    pointer-events: none;
  `;
  overlay.appendChild(selBox);

  const hint = document.createElement('div');
  hint.textContent = '드래그하여 캡처할 영역을 선택하세요 (ESC: 취소)';
  hint.style.cssText = `
    position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
    background: rgba(0,0,0,0.8); color: #fff; padding: 8px 20px;
    border-radius: 8px; font-size: 14px; font-weight: 600;
    pointer-events: none; z-index: 2147483647;
    transition: opacity 0.5s;
  `;
  overlay.appendChild(hint);
  setTimeout(() => { hint.style.opacity = '0'; }, 1500);

  let startX, startY, isDragging = false;

  overlay.addEventListener('mousedown', (e) => {
    startX = e.clientX;
    startY = e.clientY;
    isDragging = true;
    selBox.style.display = 'block';
    selBox.style.left = startX + 'px';
    selBox.style.top = startY + 'px';
    selBox.style.width = '0';
    selBox.style.height = '0';
  });

  overlay.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const x = Math.min(e.clientX, startX);
    const y = Math.min(e.clientY, startY);
    const w = Math.abs(e.clientX - startX);
    const h = Math.abs(e.clientY - startY);
    selBox.style.left = x + 'px';
    selBox.style.top = y + 'px';
    selBox.style.width = w + 'px';
    selBox.style.height = h + 'px';
  });

  overlay.addEventListener('mouseup', (e) => {
    if (!isDragging) return;
    isDragging = false;
    const x = Math.min(e.clientX, startX);
    const y = Math.min(e.clientY, startY);
    const w = Math.abs(e.clientX - startX);
    const h = Math.abs(e.clientY - startY);
    overlay.remove();
    isAreaSelecting = false;

    if (w < 10 || h < 10) return; // 너무 작으면 무시

    chrome.runtime.sendMessage({
      type: 'AREA_CAPTURE_DONE',
      screenshot,
      rect: { x, y, w, h },
      viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio || 1 },
      pageUrl: location.href,
      pageTitle: document.title
    });
  });

  // ESC로 취소
  const escHandler = (e) => {
    if (e.key === 'Escape') {
      overlay.remove();
      isAreaSelecting = false;
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);

  document.body.appendChild(overlay);
}

// Ctrl+S → 매뉴얼 JSON 저장 (크롬 기본 저장 대신)
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    chrome.runtime.sendMessage({ type: 'SAVE_JSON_SHORTCUT' });
  }
}, true);

} // end of __autoManualContentLoaded guard
