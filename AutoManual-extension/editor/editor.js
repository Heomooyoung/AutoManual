// ========================================
// editor.js — 마커 편집기 (v5)
// 도구: 사각형, 화살표, 원형, 텍스트(인라인), 블러, 크롭(상하좌우), 선택/삭제
// Undo: 블러/크롭 포함 전체 되돌리기
// ========================================

const canvas = document.getElementById('editorCanvas');
const ctx = canvas.getContext('2d');
const descList = document.getElementById('descList');
const hintEl = document.getElementById('canvasHint');
const canvasContainer = document.getElementById('canvasContainer');

const params = new URLSearchParams(location.search);
const stepIndex = parseInt(params.get('step'), 10);
if (isNaN(stepIndex)) {
  document.getElementById('canvasHint').textContent = '잘못된 접근입니다. (step 파라미터 없음)';
}

let bgImage = null;
let bgDataUrl = '';
let viewport = null;
let imgScale = 1;
let annotations = [];
let effects = [];
let currentTool = 'rect';
let isDrawing = false;
let startX = 0, startY = 0;

let currentDrawColor = '#e63232';

function getDrawColor() {
  const r = parseInt(currentDrawColor.slice(1, 3), 16);
  const g = parseInt(currentDrawColor.slice(3, 5), 16);
  const b = parseInt(currentDrawColor.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, 0.85)`;
}
function getDrawFill() {
  const r = parseInt(currentDrawColor.slice(1, 3), 16);
  const g = parseInt(currentDrawColor.slice(3, 5), 16);
  const b = parseInt(currentDrawColor.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, 0.08)`;
}
function getDrawColorSolid() {
  const r = parseInt(currentDrawColor.slice(1, 3), 16);
  const g = parseInt(currentDrawColor.slice(3, 5), 16);
  const b = parseInt(currentDrawColor.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, 0.95)`;
}

// ── Undo 히스토리 (이미지 상태 스냅샷) ──
let undoStack = []; // { bgDataUrl, canvasW, canvasH, annotations, effects }
const MAX_UNDO = 30;

function saveUndoState() {
  undoStack.push({
    bgDataUrl: bgDataUrl,
    canvasW: canvas.width,
    canvasH: canvas.height,
    annotations: JSON.parse(JSON.stringify(annotations)),
    effects: JSON.parse(JSON.stringify(effects))
  });
  if (undoStack.length > MAX_UNDO) undoStack.shift();
}

function performUndo() {
  if (undoStack.length === 0) return;
  const state = undoStack.pop();

  bgDataUrl = state.bgDataUrl;
  annotations = state.annotations;
  effects = state.effects;
  canvas.width = state.canvasW;
  canvas.height = state.canvasH;

  // 이미지 어노테이션 캐시 복원
  annotations.forEach(ann => {
    if (ann.type === 'image' && ann.imageDataUrl && !loadedImages[ann.imageDataUrl]) {
      const cachedImg = new Image();
      cachedImg.onload = () => { loadedImages[ann.imageDataUrl] = cachedImg; render(); };
      cachedImg.src = ann.imageDataUrl;
    }
  });

  const img = new Image();
  img.onload = () => {
    bgImage = img;
    render();
    renderDescList();
  };
  img.src = bgDataUrl;
}

// ── 크롭 상태 ──
let cropMode = false;
let cropTop = 0, cropBottom = 0, cropLeft = 0, cropRight = 0;
let cropDragging = null;
const CROP_HANDLE_HIT = 30;

// ── 선택 도구 상태 ──
let selectedIndex = -1;
let isDraggingSelected = false;
let dragOffsetX = 0, dragOffsetY = 0;

// ── 리사이즈/회전 상태 ──
let resizeHandle = null; // 'tl','tc','tr','ml','mr','bl','bc','br','rotate'
let resizeStartX = 0, resizeStartY = 0;
let resizeOriginal = null; // { x, y, w, h }
const HANDLE_SIZE = 8;
const HANDLE_HIT = 12;

const toolHints = {
  rect: '드래그하여 사각형을 그리세요',
  arrow: '드래그하여 화살표를 그리세요',
  circle: '드래그하여 원을 그리세요',
  text: '클릭하면 해당 위치에서 직접 텍스트를 입력할 수 있습니다',
  numbering: '클릭하면 순서대로 번호가 매겨진 원형 마커가 배치됩니다',
  blur: '드래그하여 블러 처리할 영역을 선택하세요',
  image: '버튼 클릭 시 이미지 파일을 선택하면 캔버스에 추가됩니다',
  crop: '상/하/좌/우 경계선을 드래그하여 영역 조절 → "크롭 적용" 클릭',
  select: '마커를 클릭하여 선택 → 드래그로 이동 / Delete로 삭제'
};

// ── 초기 로드 (서비스워커 대기 후 재시도) ──
function initLoad(retries) {
  chrome.runtime.sendMessage({ type: 'GET_STEPS' }, (response) => {
    if (chrome.runtime.lastError || !response?.steps?.[stepIndex]) {
      if (retries > 0) {
        setTimeout(() => initLoad(retries - 1), 300);
      } else {
        hintEl.textContent = '데이터를 불러올 수 없습니다.';
      }
      return;
    }
    onStepLoaded(response.steps[stepIndex]);
  });
}
initLoad(3);

function onStepLoaded(step) {
  bgDataUrl = step.screenshot;
  viewport = step.viewport || { width: 1920, height: 1080 };

  // 슬라이드 제목 로드 (사용자가 직접 입력한 값만 표시)
  const slideTitleInput = document.getElementById('slideTitleInput');
  if (slideTitleInput) {
    slideTitleInput.value = step.slideTitle || '';
    slideTitleInput.addEventListener('change', () => {
      chrome.runtime.sendMessage({ type: 'UPDATE_SLIDE_TITLE', index: stepIndex, slideTitle: slideTitleInput.value });
    });
    slideTitleInput.addEventListener('keydown', (e) => e.stopPropagation());
  }

  const img = new Image();
  img.onload = () => {
    bgImage = img;
    canvas.width = img.width;
    canvas.height = img.height;
    imgScale = img.width / viewport.width;

    if (step.markers?.length) {
      step.markers.forEach((m, i) => {
        const tag = m.element?.tag || '';
        const eRect = m.elementRect;

        if (tag === 'text') {
          // 텍스트 복원
          annotations.push({
            type: 'text',
            x: m.x * imgScale,
            y: m.y * imgScale,
            w: 0, h: 0,
            text: m.element?.text || m.description || '',
            fontSize: m.fontSize || 20,
            color: m.color || '#e63232',
            badgeSize: m.badgeSize || null,
            number: i + 1,
            description: m.description || m.element?.text || ''
          });
        } else if (tag === 'numbering') {
          // 넘버링 복원
          annotations.push({
            type: 'numbering',
            x: m.x * imgScale,
            y: m.y * imgScale,
            w: 0, h: 0,
            number: i + 1,
            description: m.description || '',
            color: m.color || null,
            badgeSize: m.badgeSize || null
          });
        } else if (eRect && eRect.width > 0) {
          // rect, circle, arrow 복원
          annotations.push({
            type: tag === 'arrow' ? 'arrow' : (tag === 'circle' ? 'circle' : 'rect'),
            x: eRect.x * imgScale, y: eRect.y * imgScale,
            w: eRect.width * imgScale, h: eRect.height * imgScale,
            number: i + 1, description: m.description || '',
            color: m.color || null,
            badgeSize: m.badgeSize || null
          });
        } else {
          // 폴백: 원형
          annotations.push({
            type: 'circle',
            x: (m.x * imgScale) - 20, y: (m.y * imgScale) - 20,
            w: 40, h: 40,
            number: i + 1, description: m.description || '',
            color: m.color || null,
            badgeSize: m.badgeSize || null
          });
        }
      });
    }
    // 초기 상태 저장
    saveUndoState();
    render();
    renderDescList();
  };
  img.src = bgDataUrl;
}

// ── 도구 선택 ──
document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
  btn.addEventListener('click', () => {
    if (activeTextInput) commitInlineText();
    if (cropMode && btn.dataset.tool !== 'crop') exitCropMode();

    document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentTool = btn.dataset.tool;
    hintEl.textContent = toolHints[currentTool] || '';

    // 선택 해제
    if (currentTool !== 'select') {
      selectedIndex = -1;
      render();
    }

    document.getElementById('textOptions').style.display = currentTool === 'text' ? 'flex' : 'none';
    document.getElementById('blurOptions').style.display = currentTool === 'blur' ? 'flex' : 'none';

    if (currentTool === 'crop' && !cropMode) enterCropMode();
    if (currentTool === 'image') {
      document.getElementById('imageFileInput').click();
      // 이미지 추가 후 select 도구로 전환
      setTimeout(() => {
        document.querySelector('.tool-btn[data-tool="select"]').click();
      }, 100);
    }

    // 커서
    canvas.style.cursor = (currentTool === 'select') ? 'pointer' : 'crosshair';
  });
});

// ── 컬러 팔레트 ──
document.querySelectorAll('.color-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentDrawColor = btn.dataset.color;
    // 텍스트 도구 색상도 동기화
    document.getElementById('textColor').value = currentDrawColor;
    // 선택된 마커가 있으면 색상 변경
    if (selectedIndex >= 0 && annotations[selectedIndex]) {
      saveUndoState();
      annotations[selectedIndex].color = currentDrawColor;
      render();
    }
  });
});

// ── 이미지 첨부 ──
const imageFileInput = document.getElementById('imageFileInput');
const loadedImages = {}; // dataUrl → Image 캐시

imageFileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const dataUrl = ev.target.result;
    const img = new Image();
    img.onload = () => {
      loadedImages[dataUrl] = img;
      saveUndoState();
      // 캔버스 크기의 30%로 초기 배치
      const maxW = canvas.width * 0.3;
      const scale = Math.min(maxW / img.width, maxW / img.height, 1);
      const w = img.width * scale;
      const h = img.height * scale;
      const x = (canvas.width - w) / 2;
      const y = (canvas.height - h) / 2;
      annotations.push({
        type: 'image',
        x, y, w, h,
        imageDataUrl: dataUrl,
        number: annotations.length + 1,
        description: file.name
      });
      selectedIndex = annotations.length - 1;
      render();
      renderDescList();
      // select 도구로 전환
      document.querySelector('.tool-btn[data-tool="select"]').click();
    };
    img.src = dataUrl;
  };
  reader.readAsDataURL(file);
  imageFileInput.value = ''; // 같은 파일 재선택 가능
});

// ── 리사이즈 핸들 (캔버스 ↔ 설명 패널) ──
const editorResizeHandle = document.getElementById('editorResizeHandle');
const editorDescPanel = document.getElementById('editorDescPanel');
const editorLayout = document.querySelector('.editor-layout');
let editorResizing = false;

editorResizeHandle.addEventListener('mousedown', (e) => {
  editorResizing = true;
  editorResizeHandle.classList.add('active');
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
  e.preventDefault();
});
window.addEventListener('mousemove', (e) => {
  if (!editorResizing) return;
  const layoutRect = editorLayout.getBoundingClientRect();
  const newWidth = layoutRect.right - e.clientX;
  const clamped = Math.max(180, Math.min(500, newWidth));
  editorDescPanel.style.width = clamped + 'px';
});
window.addEventListener('mouseup', () => {
  if (editorResizing) {
    editorResizing = false;
    editorResizeHandle.classList.remove('active');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }
});

// ── Undo 버튼 ──
document.getElementById('undoBtn').addEventListener('click', () => {
  if (cropMode) return;
  if (activeTextInput) { cancelInlineText(); return; }
  selectedIndex = -1;
  performUndo();
});

// ── 키보드 단축키 ──
// Ctrl+Z 전용 핸들러: 최상위에서 capture 단계로 무조건 잡음
document.addEventListener('keydown', function ctrlZHandler(e) {
  if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
    // 인라인 텍스트 입력 중이면 무시
    if (typeof activeTextInput !== 'undefined' && activeTextInput) return;

    e.preventDefault();
    e.stopImmediatePropagation();
    if (!cropMode) {
      selectedIndex = -1;
      performUndo();
    }
  }
}, true);

// 나머지 단축키 (Delete, Escape 등)
document.addEventListener('keydown', function otherKeysHandler(e) {
  // 인라인 텍스트 입력 중이면 차단
  if (typeof activeTextInput !== 'undefined' && activeTextInput) return;

  // 입력 요소에 포커스 중이면 차단
  const tag = document.activeElement?.tagName;
  if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return;

  // Delete/Backspace = 선택된 항목 삭제
  if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIndex >= 0 && currentTool === 'select') {
    e.preventDefault();
    saveUndoState();
    annotations.splice(selectedIndex, 1);
    renumber();
    selectedIndex = -1;
    render();
    renderDescList();
    return;
  }

  // Escape = 선택 해제
  if (e.key === 'Escape') {
    if (selectedIndex >= 0) {
      selectedIndex = -1;
      render();
      renderDescList();
    }
  }
});

// ── 초기화 버튼 ──
document.getElementById('clearBtn').addEventListener('click', () => {
  if (cropMode) return;
  if (activeTextInput) cancelInlineText();
  if (annotations.length === 0 && effects.length === 0) return;
  if (!confirm('모든 마커와 효과를 삭제하시겠습니까?')) return;
  saveUndoState();
  annotations = [];
  effects = [];
  selectedIndex = -1;
  render();
  renderDescList();
});

// ── 닫기 버튼 (저장 후 나가기) ──
document.getElementById('closeBtn').addEventListener('click', () => {
  saveAndClose();
});

// ══════════════════════════════════════
// 인라인 텍스트 입력
// ══════════════════════════════════════
let activeTextInput = null;
let textInputReady = false;

function createInlineTextInput(canvasX, canvasY) {
  if (activeTextInput) commitInlineText();

  const textSize = parseInt(document.getElementById('textSize').value, 10);
  const textColor = document.getElementById('textColor').value;

  const r = canvas.getBoundingClientRect();
  const scaleX = r.width / canvas.width;
  const scaleY = r.height / canvas.height;
  const containerRect = canvasContainer.getBoundingClientRect();

  const screenX = canvasX * scaleX + r.left - containerRect.left + canvasContainer.scrollLeft;
  const screenY = canvasY * scaleY + r.top - containerRect.top + canvasContainer.scrollTop;
  const displayFontSize = Math.max(14, textSize * scaleY);

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'inline-text-input';
  input.style.cssText = `
    position: absolute;
    left: ${screenX}px;
    top: ${screenY}px;
    font-size: ${displayFontSize}px;
    font-weight: bold;
    font-family: 'Malgun Gothic', sans-serif;
    color: ${textColor};
    background: rgba(255,255,255,0.95);
    border: 2px solid ${textColor};
    border-radius: 4px;
    padding: 4px 8px;
    outline: none;
    min-width: 120px;
    z-index: 1000;
  `;
  input.placeholder = '텍스트 입력 후 Enter';

  input._canvasX = canvasX;
  input._canvasY = canvasY;
  input._fontSize = textSize;
  input._color = textColor;

  canvasContainer.style.position = 'relative';
  canvasContainer.appendChild(input);
  activeTextInput = input;
  textInputReady = false;

  requestAnimationFrame(() => {
    input.focus();
    setTimeout(() => { textInputReady = true; }, 300);
  });

  input.addEventListener('keydown', (e) => {
    e.stopPropagation(); // 글로벌 키보드 핸들러 차단
    if (e.key === 'Enter') { e.preventDefault(); commitInlineText(); }
    else if (e.key === 'Escape') { e.preventDefault(); cancelInlineText(); }
  });

  input.addEventListener('blur', () => {
    if (!textInputReady) return;
    setTimeout(() => {
      if (activeTextInput === input) commitInlineText();
    }, 200);
  });

  input.addEventListener('mousedown', (e) => e.stopPropagation());
  input.addEventListener('click', (e) => e.stopPropagation());
}

function commitInlineText() {
  if (!activeTextInput) return;
  const input = activeTextInput;
  activeTextInput = null;
  textInputReady = false;
  const text = input.value.trim();

  if (text) {
    saveUndoState();
    annotations.push({
      type: 'text', x: input._canvasX, y: input._canvasY, w: 0, h: 0,
      text, fontSize: input._fontSize, color: input._color,
      number: annotations.length + 1, description: text, _addedAt: Date.now()
    });
    render();
    renderDescList();
  }
  input.remove();
}

function cancelInlineText() {
  if (!activeTextInput) return;
  const input = activeTextInput;
  activeTextInput = null;
  textInputReady = false;
  input.remove();
}

// ══════════════════════════════════════
// 선택 도구
// ══════════════════════════════════════
function hitTest(px, py) {
  // 뒤에서부터 검사 (위에 그려진 것 우선)
  for (let i = annotations.length - 1; i >= 0; i--) {
    const ann = annotations[i];
    if (ann.type === 'numbering') {
      // 넘버링: 원형 반경 내
      const dist = Math.hypot(px - ann.x, py - ann.y);
      if (dist < 22) return i;
    } else if (ann.type === 'text') {
      // 텍스트 히트 영역
      ctx.font = `bold ${ann.fontSize || 20}px 'Malgun Gothic', sans-serif`;
      const tw = ctx.measureText(ann.text || '').width;
      const th = (ann.fontSize || 20) + 6;
      if (px >= ann.x - 4 && px <= ann.x + tw + 4 && py >= ann.y - 2 && py <= ann.y + th) return i;
    } else if (ann.type === 'arrow') {
      // 화살표: 시작~끝점 근처
      const ex = ann.x + ann.w, ey = ann.y + ann.h;
      const dist = pointToSegmentDist(px, py, ann.x, ann.y, ex, ey);
      if (dist < 15) return i;
    } else {
      // rect, circle: 바운딩 박스
      const rx = Math.min(ann.x, ann.x + ann.w);
      const ry = Math.min(ann.y, ann.y + ann.h);
      const rw = Math.abs(ann.w);
      const rh = Math.abs(ann.h);
      if (px >= rx - 10 && px <= rx + rw + 10 && py >= ry - 10 && py <= ry + rh + 10) return i;
    }
  }
  return -1;
}

function pointToSegmentDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function getSelectionBounds(ann) {
  if (ann.type === 'numbering') {
    return { x: ann.x - 24, y: ann.y - 24, w: 48, h: 48 };
  } else if (ann.type === 'text') {
    ctx.font = `bold ${ann.fontSize || 20}px 'Malgun Gothic', sans-serif`;
    const tw = ctx.measureText(ann.text || '').width;
    const th = (ann.fontSize || 20) + 6;
    return { x: ann.x - 8, y: ann.y - 6, w: tw + 16, h: th + 8 };
  } else {
    const pad = ann.type === 'arrow' ? 10 : 6;
    return {
      x: Math.min(ann.x, ann.x + ann.w) - pad,
      y: Math.min(ann.y, ann.y + ann.h) - pad,
      w: Math.abs(ann.w) + pad * 2,
      h: Math.abs(ann.h) + pad * 2
    };
  }
}

function drawSelection(ann) {
  if (!ann) return;
  const b = getSelectionBounds(ann);
  ctx.save();

  // 선택 테두리
  ctx.setLineDash([6, 3]);
  ctx.strokeStyle = '#4a90d9';
  ctx.lineWidth = 2;
  ctx.strokeRect(b.x, b.y, b.w, b.h);
  ctx.setLineDash([]);

  // 넘버링/텍스트는 리사이즈 불필요
  if (ann.type === 'numbering' || ann.type === 'text') {
    ctx.restore();
    return;
  }

  // 리사이즈 핸들 (8개)
  const handles = getHandlePositions(b);
  for (const key in handles) {
    const h = handles[key];
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#4a90d9';
    ctx.lineWidth = 1.5;
    ctx.fillRect(h.x - HANDLE_SIZE / 2, h.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
    ctx.strokeRect(h.x - HANDLE_SIZE / 2, h.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
  }

  ctx.restore();
}

function getHandlePositions(b) {
  return {
    tl: { x: b.x, y: b.y },
    tc: { x: b.x + b.w / 2, y: b.y },
    tr: { x: b.x + b.w, y: b.y },
    ml: { x: b.x, y: b.y + b.h / 2 },
    mr: { x: b.x + b.w, y: b.y + b.h / 2 },
    bl: { x: b.x, y: b.y + b.h },
    bc: { x: b.x + b.w / 2, y: b.y + b.h },
    br: { x: b.x + b.w, y: b.y + b.h }
  };
}

function hitTestHandle(px, py, ann) {
  if (ann.type === 'numbering' || ann.type === 'text') return null;
  const b = getSelectionBounds(ann);

  // 리사이즈 핸들
  const handles = getHandlePositions(b);
  for (const key in handles) {
    const h = handles[key];
    if (Math.abs(px - h.x) < HANDLE_HIT && Math.abs(py - h.y) < HANDLE_HIT) return key;
  }
  return null;
}

function getHandleCursor(handle) {
  const cursors = {
    tl: 'nwse-resize', tr: 'nesw-resize',
    bl: 'nesw-resize', br: 'nwse-resize',
    tc: 'ns-resize',   bc: 'ns-resize',
    ml: 'ew-resize',   mr: 'ew-resize'
  };
  return cursors[handle] || 'default';
}

// ══════════════════════════════════════
// 크롭 모드 (상하좌우)
// ══════════════════════════════════════
function enterCropMode() {
  cropMode = true;
  cropTop = 0;
  cropBottom = canvas.height;
  cropLeft = 0;
  cropRight = canvas.width;

  const cropBar = document.createElement('div');
  cropBar.id = 'cropActionBar';
  cropBar.className = 'crop-action-bar';

  const applyBtn = document.createElement('button');
  applyBtn.textContent = '✂ 크롭 적용';
  applyBtn.className = 'crop-action-btn crop-apply';
  applyBtn.addEventListener('click', applyCropFromMode);

  const resetBtn = document.createElement('button');
  resetBtn.textContent = '↺ 초기화';
  resetBtn.className = 'crop-action-btn crop-reset';
  resetBtn.addEventListener('click', () => {
    cropTop = 0; cropBottom = canvas.height;
    cropLeft = 0; cropRight = canvas.width;
    renderCropOverlay();
  });

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = '✕ 취소';
  cancelBtn.className = 'crop-action-btn crop-cancel';
  cancelBtn.addEventListener('click', () => exitCropMode());

  cropBar.appendChild(applyBtn);
  cropBar.appendChild(resetBtn);
  cropBar.appendChild(cancelBtn);

  hintEl.style.display = 'none';
  hintEl.parentElement.appendChild(cropBar);
  renderCropOverlay();
}

function exitCropMode() {
  cropMode = false;
  cropDragging = null;
  canvas.style.cursor = 'crosshair';
  const cropBar = document.getElementById('cropActionBar');
  if (cropBar) cropBar.remove();
  hintEl.style.display = '';
  hintEl.textContent = toolHints[currentTool] || '';
  render();
}

function applyCropFromMode() {
  if (!bgImage) return;

  const t = Math.min(cropTop, cropBottom);
  const b = Math.max(cropTop, cropBottom);
  const l = Math.min(cropLeft, cropRight);
  const r = Math.max(cropLeft, cropRight);
  const cw = r - l, ch = b - t;

  if (cw < 20 || ch < 20) {
    alert('크롭 영역이 너무 작습니다.');
    return;
  }

  saveUndoState();

  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = cw;
  tempCanvas.height = ch;
  const tCtx = tempCanvas.getContext('2d');
  tCtx.drawImage(bgImage, l, t, cw, ch, 0, 0, cw, ch);

  const newImg = new Image();
  newImg.onload = () => {
    bgImage = newImg;
    bgDataUrl = tempCanvas.toDataURL('image/jpeg', 0.9);
    canvas.width = cw;
    canvas.height = ch;
    annotations.forEach(ann => { ann.x -= l; ann.y -= t; });
    exitCropMode();
    render();
    renderDescList();
    hintEl.textContent = '크롭 완료!';
  };
  newImg.src = tempCanvas.toDataURL('image/jpeg', 0.9);
}

function renderCropOverlay() {
  if (!cropMode || !bgImage) return;
  render();

  const t = Math.min(cropTop, cropBottom);
  const b = Math.max(cropTop, cropBottom);
  const l = Math.min(cropLeft, cropRight);
  const r = Math.max(cropLeft, cropRight);

  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.fillRect(0, 0, canvas.width, t);
  ctx.fillRect(0, b, canvas.width, canvas.height - b);
  ctx.fillRect(0, t, l, b - t);
  ctx.fillRect(r, t, canvas.width - r, b - t);

  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 4]);
  ctx.strokeRect(l, t, r - l, b - t);
  ctx.setLineDash([]);

  drawHorizontalHandle(t, '#4a90d9', '▲ 위');
  drawHorizontalHandle(b, '#e6832a', '▼ 아래');
  drawVerticalHandle(l, '#34c759', '◀ 좌');
  drawVerticalHandle(r, '#af52de', '▶ 우');

  const info = `${Math.round(r - l)} × ${Math.round(b - t)}px`;
  const cx = (l + r) / 2, cy = (t + b) / 2;
  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  ctx.font = 'bold 13px sans-serif';
  const tw = ctx.measureText(info).width;
  ctx.fillRect(cx - tw / 2 - 10, cy - 14, tw + 20, 28);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(info, cx, cy);
}

function drawHorizontalHandle(y, color, label) {
  const l = Math.min(cropLeft, cropRight);
  const r = Math.max(cropLeft, cropRight);
  ctx.strokeStyle = color; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(l, y); ctx.lineTo(r, y); ctx.stroke();
  const hx = (l + r) / 2;
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.roundRect(hx - 45, y - 16, 90, 32, 16); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(label, hx, y);
}

function drawVerticalHandle(x, color, label) {
  const t = Math.min(cropTop, cropBottom);
  const b = Math.max(cropTop, cropBottom);
  ctx.strokeStyle = color; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(x, t); ctx.lineTo(x, b); ctx.stroke();
  const hy = (t + b) / 2;
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.roundRect(x - 30, hy - 16, 60, 32, 16); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(label, x, hy);
}

function getCropHandleAt(px, py) {
  const t = Math.min(cropTop, cropBottom), b = Math.max(cropTop, cropBottom);
  const l = Math.min(cropLeft, cropRight), r = Math.max(cropLeft, cropRight);
  const dTop = Math.abs(py - cropTop), dBottom = Math.abs(py - cropBottom);
  const dLeft = Math.abs(px - cropLeft), dRight = Math.abs(px - cropRight);
  const inH = px >= l - CROP_HANDLE_HIT && px <= r + CROP_HANDLE_HIT;
  const inV = py >= t - CROP_HANDLE_HIT && py <= b + CROP_HANDLE_HIT;

  const c = [];
  if (inH && dTop < CROP_HANDLE_HIT) c.push({ h: 'top', d: dTop });
  if (inH && dBottom < CROP_HANDLE_HIT) c.push({ h: 'bottom', d: dBottom });
  if (inV && dLeft < CROP_HANDLE_HIT) c.push({ h: 'left', d: dLeft });
  if (inV && dRight < CROP_HANDLE_HIT) c.push({ h: 'right', d: dRight });
  if (!c.length) return null;
  c.sort((a, b) => a.d - b.d);
  return c[0].h;
}

// ══════════════════════════════════════
// 캔버스 이벤트
// ══════════════════════════════════════
canvas.addEventListener('mousedown', (e) => {
  if (activeTextInput) return;

  const r = canvas.getBoundingClientRect();
  const sx = canvas.width / r.width, sy = canvas.height / r.height;
  const px = (e.clientX - r.left) * sx, py = (e.clientY - r.top) * sy;

  // 크롭 모드
  if (cropMode) {
    const handle = getCropHandleAt(px, py);
    if (handle) {
      cropDragging = handle;
      canvas.style.cursor = (handle === 'top' || handle === 'bottom') ? 'ns-resize' : 'ew-resize';
    }
    return;
  }

  // 선택 도구
  if (currentTool === 'select') {
    // 선택된 마커가 있으면 핸들 클릭 우선 체크
    if (selectedIndex >= 0 && selectedIndex < annotations.length) {
      const ann = annotations[selectedIndex];
      const handle = hitTestHandle(px, py, ann);
      if (handle) {
        saveUndoState();
        resizeHandle = handle;
        resizeStartX = px;
        resizeStartY = py;
        resizeOriginal = { x: ann.x, y: ann.y, w: ann.w, h: ann.h };
        canvas.style.cursor = getHandleCursor(handle);
        return;
      }
    }

    const idx = hitTest(px, py);
    if (idx >= 0) {
      // 이미 선택된 마커를 다시 클릭 → 드래그 이동
      if (selectedIndex === idx) {
        isDraggingSelected = true;
        saveUndoState();
        const ann = annotations[idx];
        dragOffsetX = px - ann.x;
        dragOffsetY = py - ann.y;
        canvas.style.cursor = 'grabbing';
        return;
      }
      // 새 마커 선택
      selectedIndex = idx;
      canvas.style.cursor = 'grab';
    } else {
      selectedIndex = -1;
      canvas.style.cursor = 'pointer';
    }
    render();
    if (selectedIndex >= 0) drawSelection(annotations[selectedIndex]);
    renderDescList();
    return;
  }

  // 텍스트 도구
  if (currentTool === 'text') {
    e.preventDefault();
    createInlineTextInput(px, py);
    return;
  }

  // 넘버링 도구: 클릭하면 원형 번호 마커 배치
  if (currentTool === 'numbering') {
    saveUndoState();
    const nextNum = annotations.length + 1;
    annotations.push({
      type: 'numbering', x: px, y: py, w: 0, h: 0,
      number: nextNum, description: '', _addedAt: Date.now(),
      badgeSize: getBadgeSize(), color: currentDrawColor
    });
    render();
    renderDescList();
    return;
  }

  isDrawing = true;
  startX = px;
  startY = py;
});

canvas.addEventListener('mousemove', (e) => {
  if (activeTextInput) return;

  const r = canvas.getBoundingClientRect();
  const sx = canvas.width / r.width, sy = canvas.height / r.height;
  const curX = (e.clientX - r.left) * sx, curY = (e.clientY - r.top) * sy;

  if (cropMode) {
    if (cropDragging) {
      if (cropDragging === 'top') cropTop = Math.max(0, Math.min(curY, canvas.height));
      else if (cropDragging === 'bottom') cropBottom = Math.max(0, Math.min(curY, canvas.height));
      else if (cropDragging === 'left') cropLeft = Math.max(0, Math.min(curX, canvas.width));
      else if (cropDragging === 'right') cropRight = Math.max(0, Math.min(curX, canvas.width));
      renderCropOverlay();
    } else {
      const handle = getCropHandleAt(curX, curY);
      if (handle === 'top' || handle === 'bottom') canvas.style.cursor = 'ns-resize';
      else if (handle === 'left' || handle === 'right') canvas.style.cursor = 'ew-resize';
      else canvas.style.cursor = 'default';
    }
    return;
  }

  // 선택 도구 — 리사이즈/회전 드래그 중
  if (currentTool === 'select' && resizeHandle && selectedIndex >= 0) {
    const ann = annotations[selectedIndex];
    const dx = curX - resizeStartX;
    const dy = curY - resizeStartY;
    const o = resizeOriginal;

    {
      // 리사이즈
      if (resizeHandle.includes('l')) { ann.x = o.x + dx; ann.w = o.w - dx; }
      if (resizeHandle.includes('r')) { ann.w = o.w + dx; }
      if (resizeHandle.includes('t')) { ann.y = o.y + dy; ann.h = o.h - dy; }
      if (resizeHandle.includes('b')) { ann.h = o.h + dy; }
    }
    render();
    drawSelection(ann);
    return;
  }

  // 선택 도구 — 핸들 호버 시 커서 변경
  if (currentTool === 'select' && !isDraggingSelected && !resizeHandle && selectedIndex >= 0) {
    const ann = annotations[selectedIndex];
    const handle = hitTestHandle(curX, curY, ann);
    if (handle) {
      canvas.style.cursor = getHandleCursor(handle);
    } else {
      const idx = hitTest(curX, curY);
      canvas.style.cursor = idx >= 0 ? 'grab' : 'default';
    }
  }

  // 선택 도구 드래그 이동
  if (currentTool === 'select' && isDraggingSelected && selectedIndex >= 0) {
    const ann = annotations[selectedIndex];
    ann.x = curX - dragOffsetX;
    ann.y = curY - dragOffsetY;
    render();
    drawSelection(ann);
    return;
  }

  if (!isDrawing) return;
  render();
  if (currentTool === 'blur') {
    drawBlurPreview(ctx, startX, startY, curX - startX, curY - startY);
  } else {
    drawShape(ctx, currentTool, startX, startY, curX - startX, curY - startY, 0, true, { color: currentDrawColor });
  }
});

canvas.addEventListener('mouseup', (e) => {
  if (activeTextInput) return;

  if (cropMode) {
    if (cropDragging) { cropDragging = null; canvas.style.cursor = 'default'; renderCropOverlay(); }
    return;
  }

  // 선택 도구 — 리사이즈/회전 종료
  if (currentTool === 'select' && resizeHandle) {
    resizeHandle = null;
    resizeOriginal = null;
    canvas.style.cursor = 'grab';
    render();
    if (selectedIndex >= 0) drawSelection(annotations[selectedIndex]);
    renderDescList();
    return;
  }

  // 선택 도구 드래그 종료
  if (currentTool === 'select' && isDraggingSelected) {
    isDraggingSelected = false;
    canvas.style.cursor = 'grab';
    render();
    if (selectedIndex >= 0) drawSelection(annotations[selectedIndex]);
    renderDescList();
    return;
  }

  if (!isDrawing) return;
  isDrawing = false;

  const r = canvas.getBoundingClientRect();
  const sx = canvas.width / r.width, sy = canvas.height / r.height;
  const endX = (e.clientX - r.left) * sx, endY = (e.clientY - r.top) * sy;
  let w = endX - startX, h = endY - startY;

  if (currentTool === 'blur') {
    if (Math.abs(w) > 5 && Math.abs(h) > 5) {
      saveUndoState();
      effects.push({
        type: 'blur',
        x: Math.min(startX, startX + w), y: Math.min(startY, startY + h),
        w: Math.abs(w), h: Math.abs(h),
        strength: parseInt(document.getElementById('blurStrength').value, 10),
        _addedAt: Date.now()
      });
      bakeBlurToImage();
    }
    render();
    return;
  }

  // 일반 도형
  if (Math.abs(w) < 10 && Math.abs(h) < 10) {
    if (currentTool === 'circle') { w = 40; h = 40; startX -= 20; startY -= 20; }
    else if (currentTool === 'arrow') { w = 100; h = 0; }
    else { w = 120; h = 40; startX -= 60; startY -= 20; }
  }

  saveUndoState();
  annotations.push({
    type: currentTool, x: startX, y: startY, w, h,
    number: annotations.length + 1, description: '', _addedAt: Date.now(),
    color: currentDrawColor, badgeSize: getBadgeSize()
  });
  render();
  renderDescList();
});

canvas.addEventListener('mouseleave', () => {
  if (isDrawing) { isDrawing = false; render(); }
  if (cropMode && cropDragging) { cropDragging = null; canvas.style.cursor = 'default'; }
  if (isDraggingSelected) { isDraggingSelected = false; canvas.style.cursor = 'pointer'; }
  if (resizeHandle) { resizeHandle = null; resizeOriginal = null; }
});

// ══════════════════════════════════════
// 블러 처리
// ══════════════════════════════════════
function bakeBlurToImage() {
  const lastBlur = effects[effects.length - 1];
  if (!lastBlur || !bgImage) return;

  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = bgImage.width || canvas.width;
  tempCanvas.height = bgImage.height || canvas.height;
  const tCtx = tempCanvas.getContext('2d');
  tCtx.drawImage(bgImage, 0, 0);

  const bx = Math.max(0, Math.floor(lastBlur.x));
  const by = Math.max(0, Math.floor(lastBlur.y));
  const bw = Math.min(Math.ceil(lastBlur.w), tempCanvas.width - bx);
  const bh = Math.min(Math.ceil(lastBlur.h), tempCanvas.height - by);
  if (bw <= 0 || bh <= 0) return;

  const strength = lastBlur.strength || 16;
  const blurCanvas = document.createElement('canvas');
  const scale = Math.max(1, strength);
  blurCanvas.width = Math.max(1, Math.floor(bw / scale));
  blurCanvas.height = Math.max(1, Math.floor(bh / scale));
  const bCtx = blurCanvas.getContext('2d');
  bCtx.drawImage(tempCanvas, bx, by, bw, bh, 0, 0, blurCanvas.width, blurCanvas.height);
  tCtx.imageSmoothingEnabled = true;
  tCtx.drawImage(blurCanvas, 0, 0, blurCanvas.width, blurCanvas.height, bx, by, bw, bh);

  const newImg = new Image();
  newImg.onload = () => {
    bgImage = newImg;
    bgDataUrl = tempCanvas.toDataURL('image/jpeg', 0.9);
    render();
  };
  newImg.src = tempCanvas.toDataURL('image/jpeg', 0.9);
}

function drawBlurPreview(ctx, x, y, w, h) {
  const rx = Math.min(x, x + w), ry = Math.min(y, y + h);
  const rw = Math.abs(w), rh = Math.abs(h);
  ctx.save();
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = '#4a90d9'; ctx.lineWidth = 2;
  ctx.strokeRect(rx, ry, rw, rh);
  ctx.fillStyle = 'rgba(74, 144, 217, 0.15)';
  ctx.fillRect(rx, ry, rw, rh);
  ctx.setLineDash([]);
  ctx.fillStyle = '#4a90d9'; ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('BLUR', rx + rw / 2, ry + rh / 2 + 5);
  ctx.restore();
}

// ══════════════════════════════════════
// 렌더링
// ══════════════════════════════════════
function getBadgeSize() {
  return parseInt(document.getElementById('badgeSizeSelect').value, 10) || 22;
}

function render() {
  if (!bgImage) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bgImage, 0, 0);
  annotations.forEach(ann => {
    drawShape(ctx, ann.type, ann.x, ann.y, ann.w, ann.h, ann.number, false, ann);
  });
  // 선택 표시
  if (selectedIndex >= 0 && selectedIndex < annotations.length && currentTool === 'select') {
    drawSelection(annotations[selectedIndex]);
  }
}

function annColor(ann, alpha) {
  const c = (ann && ann.color) || '#e63232';
  const r = parseInt(c.slice(1, 3), 16);
  const g = parseInt(c.slice(3, 5), 16);
  const b = parseInt(c.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function drawShape(ctx, type, x, y, w, h, number, isPreview, ann) {
  ctx.save();
  ctx.globalAlpha = isPreview ? 0.5 : 1;
  let badgePos = null;

  if (type === 'rect') {
    const pad = 4;
    const rx = Math.min(x, x + w) - pad, ry = Math.min(y, y + h) - pad;
    const rw = Math.abs(w) + pad*2, rh = Math.abs(h) + pad*2;
    ctx.beginPath(); ctx.roundRect(rx, ry, rw, rh, 8);
    ctx.fillStyle = annColor(ann, 0.08); ctx.fill();
    ctx.strokeStyle = annColor(ann, 0.85); ctx.lineWidth = 3; ctx.stroke();
    badgePos = { x: rx - 8, y: ry - 8 };

  } else if (type === 'arrow') {
    const ex = x + w, ey = y + h;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex, ey);
    ctx.strokeStyle = annColor(ann, 0.85); ctx.lineWidth = 3; ctx.stroke();
    const angle = Math.atan2(h, w), hl = 18;
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - hl*Math.cos(angle-0.4), ey - hl*Math.sin(angle-0.4));
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - hl*Math.cos(angle+0.4), ey - hl*Math.sin(angle+0.4));
    ctx.stroke();
    badgePos = { x: x - 14, y: y - 14 };

  } else if (type === 'circle') {
    const cx = x+w/2, cy = y+h/2;
    const rx2 = Math.max(Math.abs(w)/2, 4), ry2 = Math.max(Math.abs(h)/2, 4);
    ctx.beginPath(); ctx.ellipse(cx, cy, rx2, ry2, 0, 0, Math.PI*2);
    ctx.fillStyle = annColor(ann, 0.08); ctx.fill();
    ctx.strokeStyle = annColor(ann, 0.85); ctx.lineWidth = 3; ctx.stroke();
    badgePos = { x: cx - rx2 - 8, y: cy - ry2 - 8 };

  } else if (type === 'text' && ann) {
    const fs = ann.fontSize || 20;
    const clr = ann.color || currentDrawColor;
    ctx.font = `bold ${fs}px 'Malgun Gothic', sans-serif`;
    ctx.textBaseline = 'top';
    const tw = ctx.measureText(ann.text || '').width;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(x - 4, y - 2, tw + 8, fs + 6);
    ctx.fillStyle = clr;
    ctx.fillText(ann.text || '', x, y);
    // 텍스트는 자체가 내용이므로 번호 배지 불필요

  } else if (type === 'image' && ann) {
    const cachedImg = loadedImages[ann.imageDataUrl];
    if (cachedImg) {
      ctx.drawImage(cachedImg, x, y, w, h);
      ctx.strokeStyle = 'rgba(0,122,255,0.3)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, w, h);
    }
    ctx.restore();
    return;

  } else if (type === 'numbering') {
    const sz = (ann && ann.badgeSize) || 28;
    const radius = sz / 2;
    const fontSize = Math.round(sz * 0.45);
    ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = annColor(ann, 0.95);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(2, sz * 0.08); ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${fontSize}px -apple-system, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(number), x, y);
    ctx.restore();
    return;
  }

  if (number > 0 && badgePos) {
    const sz = (ann && ann.badgeSize) || 28;
    const bx = Math.max(2, Math.min(badgePos.x, canvas.width - sz - 2));
    const by = Math.max(2, Math.min(badgePos.y, canvas.height - sz - 2));
    const fontSize = Math.round(sz * 0.45);
    ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = 4;
    ctx.beginPath(); ctx.arc(bx+sz/2, by+sz/2, sz/2, 0, Math.PI*2);
    ctx.fillStyle = annColor(ann, 0.95); ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(2, sz * 0.08); ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${fontSize}px -apple-system, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(number), bx+sz/2, by+sz/2);
  }

  ctx.restore();
}

function renumber() {
  annotations.forEach((ann, i) => ann.number = i + 1);
}

// ══════════════════════════════════════
// 설명 목록
// ══════════════════════════════════════
let descDragFrom = null;

function renderDescList() {
  descList.innerHTML = '';
  if (annotations.length === 0) {
    descList.innerHTML = '<div class="desc-empty">도형을 그리면 여기에 설명란이 생깁니다</div>';
    return;
  }
  const typeNames = { rect: '사각형', arrow: '화살표', circle: '원형', text: '텍스트', numbering: '넘버링', image: '사진' };
  annotations.forEach((ann, i) => {
    // 텍스트, 사진은 설명란에서 제외
    if (ann.type === 'text' || ann.type === 'image') return;
    const item = document.createElement('div');
    item.className = 'desc-item' + (selectedIndex === i ? ' desc-item-selected' : '');
    item.draggable = true;
    item.dataset.descIndex = i;

    // 드래그 순서 변경
    item.addEventListener('dragstart', (e) => {
      descDragFrom = i;
      item.classList.add('desc-dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', i);
    });
    item.addEventListener('dragend', () => {
      item.classList.remove('desc-dragging');
      descList.querySelectorAll('.desc-dragover').forEach(el => el.classList.remove('desc-dragover'));
      descDragFrom = null;
    });
    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (descDragFrom !== null && descDragFrom !== i) {
        item.classList.add('desc-dragover');
      }
    });
    item.addEventListener('dragleave', () => item.classList.remove('desc-dragover'));
    item.addEventListener('drop', (e) => {
      e.preventDefault();
      item.classList.remove('desc-dragover');
      if (descDragFrom !== null && descDragFrom !== i) {
        saveUndoState();
        const [moved] = annotations.splice(descDragFrom, 1);
        annotations.splice(i, 0, moved);
        renumber();
        if (selectedIndex === descDragFrom) selectedIndex = i;
        else if (selectedIndex > descDragFrom && selectedIndex <= i) selectedIndex--;
        else if (selectedIndex < descDragFrom && selectedIndex >= i) selectedIndex++;
        render();
        renderDescList();
        // 피드백: 이동된 항목 하이라이트
        setTimeout(() => {
          const items = descList.querySelectorAll('.desc-item');
          if (items[i]) {
            items[i].classList.add('desc-just-moved');
            setTimeout(() => items[i].classList.remove('desc-just-moved'), 1500);
          }
        }, 50);
      }
    });

    const header = document.createElement('div');
    header.className = 'desc-item-header';

    const dragHandle = document.createElement('span');
    dragHandle.className = 'desc-drag-handle';
    dragHandle.textContent = '⠿';
    dragHandle.title = '드래그하여 순서 변경';

    const badge = document.createElement('span');
    badge.className = 'desc-badge';
    badge.textContent = ann.number;

    const typeLbl = document.createElement('span');
    typeLbl.className = 'desc-type';
    typeLbl.textContent = typeNames[ann.type] || ann.type;

    // 선택 버튼
    const selectBtn = document.createElement('button');
    selectBtn.className = 'desc-select-btn';
    selectBtn.textContent = '선택';
    selectBtn.addEventListener('click', () => {
      selectedIndex = i;
      currentTool = 'select';
      document.querySelectorAll('.tool-btn[data-tool]').forEach(b => {
        b.classList.toggle('active', b.dataset.tool === 'select');
      });
      canvas.style.cursor = 'pointer';
      hintEl.textContent = toolHints.select;
      render();
      renderDescList();
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'desc-del-btn';
    delBtn.textContent = '삭제';
    delBtn.addEventListener('click', () => {
      saveUndoState();
      annotations.splice(i, 1);
      renumber();
      if (selectedIndex === i) selectedIndex = -1;
      else if (selectedIndex > i) selectedIndex--;
      render();
      renderDescList();
    });

    header.appendChild(dragHandle);
    header.appendChild(badge);
    header.appendChild(typeLbl);
    header.appendChild(selectBtn);
    header.appendChild(delBtn);

    const ta = document.createElement('textarea');
    ta.placeholder = `${ann.number}번 설명...`;
    ta.value = ann.description || (ann.type === 'text' ? ann.text : '');
    ta.addEventListener('input', (e) => { ann.description = e.target.value; });

    item.appendChild(header);
    item.appendChild(ta);
    descList.appendChild(item);
  });
}

// ══════════════════════════════════════
// 최종 저장 (재시도 로직 포함)
// ══════════════════════════════════════
function sendMessageWithRetry(msg, retries, callback) {
  chrome.runtime.sendMessage(msg, (response) => {
    if (chrome.runtime.lastError || !response?.success) {
      if (retries > 0) {
        setTimeout(() => sendMessageWithRetry(msg, retries - 1, callback), 300);
      } else {
        callback(response);
      }
    } else {
      callback(response);
    }
  });
}

function closeEditor() {
  // iframe 안이면 부모에게 닫기 요청, 아니면 window.close()
  if (window.parent !== window) {
    window.parent.postMessage({ type: 'EDITOR_MODAL_CLOSE' }, '*');
  } else {
    window.close();
  }
}

function saveAndClose() {
  if (!viewport || !bgImage) { closeEditor(); return; }
  if (cropMode) exitCropMode();
  if (activeTextInput) commitInlineText();
  selectedIndex = -1;

  const invScale = 1 / imgScale;

  const markers = annotations.map((ann, i) => {
    const marker = {
      x: ann.type === 'numbering' ? ann.x * invScale : (ann.x + (ann.w||0)/2) * invScale,
      y: ann.type === 'numbering' ? ann.y * invScale : (ann.y + (ann.h||0)/2) * invScale,
      number: i + 1,
      elementRect: (ann.type !== 'arrow' && ann.type !== 'text' && ann.type !== 'numbering') ? {
        x: Math.min(ann.x, ann.x + (ann.w||0)) * invScale,
        y: Math.min(ann.y, ann.y + (ann.h||0)) * invScale,
        width: Math.abs(ann.w||0) * invScale,
        height: Math.abs(ann.h||0) * invScale
      } : null,
      element: { tag: ann.type, text: ann.text || '' },
      description: ann.description || (ann.type === 'text' ? ann.text : '')
    };
    // 모든 타입에 색상/사이즈 보존
    if (ann.color) marker.color = ann.color;
    if (ann.badgeSize) marker.badgeSize = ann.badgeSize;
    if (ann.type === 'text') {
      marker.fontSize = ann.fontSize || 20;
    }
    return marker;
  });

  render();
  const markedDataUrl = canvas.toDataURL('image/jpeg', 0.85);

  sendMessageWithRetry({
    type: 'SAVE_EDITOR',
    stepIndex,
    markers,
    screenshotWithMarker: markedDataUrl,
    screenshot: bgDataUrl,
    description: markers.map((m,i) => `${i+1}. ${m.description||''}`).filter(d=>d.length>3).join('\n')
  }, 3, (response) => {
    if (response?.success) {
      chrome.runtime.sendMessage({ type: 'EDITOR_SAVED' }).catch(()=>{});
      closeEditor();
    } else {
      alert('저장에 실패했습니다. 다시 시도해주세요.');
    }
  });
}
