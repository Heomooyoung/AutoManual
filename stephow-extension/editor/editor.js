// ========================================
// editor.js — 마커 편집기
// 도구: 사각형, 화살표, 원형 + 자동 번호 + 마커별 설명
// ========================================

const canvas = document.getElementById('editorCanvas');
const ctx = canvas.getContext('2d');
const descList = document.getElementById('descList');

const params = new URLSearchParams(location.search);
const stepIndex = parseInt(params.get('step'), 10);

let bgImage = null;
let bgDataUrl = '';
let viewport = null;
let imgScale = 1;           // 이미지 픽셀 ↔ viewport 변환 비율
let annotations = [];
let currentTool = 'rect';
let isDrawing = false;
let startX = 0, startY = 0;

const DRAW_COLOR = 'rgba(230, 50, 50, 0.85)';
const DRAW_FILL = 'rgba(230, 50, 50, 0.08)';

// ── 초기 로드 ──
chrome.runtime.sendMessage({ type: 'GET_STEPS' }, (response) => {
  if (!response?.steps?.[stepIndex]) {
    document.querySelector('.canvas-hint').textContent =
      '데이터를 불러올 수 없습니다. 사이드 패널에서 녹화 후 다시 시도하세요.';
    return;
  }

  const step = response.steps[stepIndex];
  bgDataUrl = step.screenshot;
  viewport = step.viewport || { width: 1920, height: 1080 };

  const img = new Image();
  img.onload = () => {
    bgImage = img;
    canvas.width = img.width;
    canvas.height = img.height;

    // viewport → 이미지 픽셀 변환 비율
    imgScale = img.width / viewport.width;

    // 기존 마커를 annotations으로 변환 (viewport 좌표 → 이미지 픽셀 좌표)
    if (step.markers?.length) {
      step.markers.forEach((m, i) => {
        const eRect = m.elementRect;
        if (eRect && eRect.width > 0) {
          annotations.push({
            type: 'rect',
            x: eRect.x * imgScale,
            y: eRect.y * imgScale,
            w: eRect.width * imgScale,
            h: eRect.height * imgScale,
            number: i + 1,
            description: m.description || ''
          });
        } else {
          annotations.push({
            type: 'circle',
            x: (m.x * imgScale) - 20,
            y: (m.y * imgScale) - 20,
            w: 40, h: 40,
            number: i + 1,
            description: m.description || ''
          });
        }
      });
    }

    render();
    renderDescList();
  };
  img.src = bgDataUrl;
});

// ── 도구 선택 ──
document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentTool = btn.dataset.tool;
  });
});

document.getElementById('undoBtn').addEventListener('click', () => {
  annotations.pop();
  renumber();
  render();
  renderDescList();
});

document.getElementById('clearBtn').addEventListener('click', () => {
  if (!confirm('모든 마커를 삭제하시겠습니까?')) return;
  annotations = [];
  render();
  renderDescList();
});

// ── 캔버스 드래그 그리기 ──
canvas.addEventListener('mousedown', (e) => {
  isDrawing = true;
  const r = canvas.getBoundingClientRect();
  const sx = canvas.width / r.width;
  const sy = canvas.height / r.height;
  startX = (e.clientX - r.left) * sx;
  startY = (e.clientY - r.top) * sy;
});

canvas.addEventListener('mousemove', (e) => {
  if (!isDrawing) return;
  const r = canvas.getBoundingClientRect();
  const sx = canvas.width / r.width;
  const sy = canvas.height / r.height;
  const curX = (e.clientX - r.left) * sx;
  const curY = (e.clientY - r.top) * sy;
  render();
  drawShape(ctx, currentTool, startX, startY, curX - startX, curY - startY, 0, true);
});

canvas.addEventListener('mouseup', (e) => {
  if (!isDrawing) return;
  isDrawing = false;

  const r = canvas.getBoundingClientRect();
  const sx = canvas.width / r.width;
  const sy = canvas.height / r.height;
  const endX = (e.clientX - r.left) * sx;
  const endY = (e.clientY - r.top) * sy;

  let w = endX - startX;
  let h = endY - startY;

  if (Math.abs(w) < 10 && Math.abs(h) < 10) {
    if (currentTool === 'circle') { w = 40; h = 40; startX -= 20; startY -= 20; }
    else if (currentTool === 'arrow') { w = 100; h = 0; }
    else { w = 120; h = 40; startX -= 60; startY -= 20; }
  }

  annotations.push({
    type: currentTool,
    x: startX, y: startY, w, h,
    number: annotations.length + 1,
    description: ''
  });
  render();
  renderDescList();
});

canvas.addEventListener('mouseleave', () => {
  if (isDrawing) { isDrawing = false; render(); }
});

// ── 렌더링 ──
function render() {
  if (!bgImage) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bgImage, 0, 0);
  annotations.forEach(ann => {
    drawShape(ctx, ann.type, ann.x, ann.y, ann.w, ann.h, ann.number, false);
  });
}

function drawShape(ctx, type, x, y, w, h, number, isPreview) {
  ctx.save();
  ctx.globalAlpha = isPreview ? 0.5 : 1;

  if (type === 'rect') {
    const pad = 4;
    const rx = Math.min(x, x + w) - pad;
    const ry = Math.min(y, y + h) - pad;
    const rw = Math.abs(w) + pad * 2;
    const rh = Math.abs(h) + pad * 2;
    ctx.beginPath();
    ctx.roundRect(rx, ry, rw, rh, 8);
    ctx.fillStyle = DRAW_FILL;
    ctx.fill();
    ctx.strokeStyle = DRAW_COLOR;
    ctx.lineWidth = 3;
    ctx.stroke();
    if (number > 0) drawBadge(ctx, rx - 8, ry - 8, number);

  } else if (type === 'arrow') {
    const ex = x + w, ey = y + h;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(ex, ey);
    ctx.strokeStyle = DRAW_COLOR;
    ctx.lineWidth = 3;
    ctx.stroke();
    const angle = Math.atan2(h, w);
    const hl = 18;
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - hl * Math.cos(angle - 0.4), ey - hl * Math.sin(angle - 0.4));
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - hl * Math.cos(angle + 0.4), ey - hl * Math.sin(angle + 0.4));
    ctx.stroke();
    if (number > 0) drawBadge(ctx, x - 14, y - 14, number);

  } else if (type === 'circle') {
    const cx = x + w / 2, cy = y + h / 2;
    const rx = Math.max(Math.abs(w) / 2, 4);
    const ry = Math.max(Math.abs(h) / 2, 4);
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = DRAW_FILL;
    ctx.fill();
    ctx.strokeStyle = DRAW_COLOR;
    ctx.lineWidth = 3;
    ctx.stroke();
    if (number > 0) drawBadge(ctx, cx - rx - 8, cy - ry - 8, number);
  }
  ctx.restore();
}

function drawBadge(ctx, x, y, number) {
  const s = 24;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.3)';
  ctx.shadowBlur = 4;
  ctx.beginPath();
  ctx.arc(x + s / 2, y + s / 2, s / 2, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(230,50,50,0.95)';
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 13px -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(number), x + s / 2, y + s / 2);
}

function renumber() {
  annotations.forEach((ann, i) => ann.number = i + 1);
}

// ── 설명 목록 ──
function renderDescList() {
  descList.innerHTML = '';
  if (annotations.length === 0) {
    descList.innerHTML = '<div class="desc-empty">도형을 그리면 여기에 설명란이 생깁니다</div>';
    return;
  }
  const typeNames = { rect: '사각형', arrow: '화살표', circle: '원형' };
  annotations.forEach((ann, i) => {
    const item = document.createElement('div');
    item.className = 'desc-item';

    const header = document.createElement('div');
    header.className = 'desc-item-header';
    const badge = document.createElement('span');
    badge.className = 'desc-badge';
    badge.textContent = ann.number;
    const typeLbl = document.createElement('span');
    typeLbl.className = 'desc-type';
    typeLbl.textContent = typeNames[ann.type] || ann.type;
    const delBtn = document.createElement('button');
    delBtn.className = 'desc-del-btn';
    delBtn.textContent = '삭제';
    delBtn.addEventListener('click', () => {
      annotations.splice(i, 1);
      renumber(); render(); renderDescList();
    });
    header.appendChild(badge);
    header.appendChild(typeLbl);
    header.appendChild(delBtn);

    const ta = document.createElement('textarea');
    ta.placeholder = `${ann.number}번 설명 입력...`;
    ta.value = ann.description;
    ta.addEventListener('input', (e) => { ann.description = e.target.value; });

    item.appendChild(header);
    item.appendChild(ta);
    descList.appendChild(item);
  });
}

// ── 저장 ──
document.getElementById('saveBtn').addEventListener('click', () => {
  if (!viewport || !bgImage) return;

  // 이미지 픽셀 좌표 → viewport 좌표로 역변환
  const invScale = 1 / imgScale;

  const markers = annotations.map((ann, i) => ({
    x: (ann.x + (ann.w || 0) / 2) * invScale,
    y: (ann.y + (ann.h || 0) / 2) * invScale,
    number: i + 1,
    elementRect: (ann.type === 'rect' || ann.type === 'circle') ? {
      x: Math.min(ann.x, ann.x + ann.w) * invScale,
      y: Math.min(ann.y, ann.y + ann.h) * invScale,
      width: Math.abs(ann.w) * invScale,
      height: Math.abs(ann.h) * invScale
    } : null,
    element: { tag: ann.type, text: '' },
    description: ann.description
  }));

  const markedDataUrl = canvas.toDataURL('image/jpeg', 0.85);

  chrome.runtime.sendMessage({
    type: 'SAVE_EDITOR',
    stepIndex,
    markers,
    screenshotWithMarker: markedDataUrl,
    description: markers.map((m, i) => `${i + 1}. ${m.description || ''}`).filter(d => d.length > 3).join('\n')
  }, (response) => {
    if (response?.success) {
      alert('저장되었습니다! 사이드 패널을 새로고침합니다.');
      // 사이드 패널에 새로고침 알림
      chrome.runtime.sendMessage({ type: 'EDITOR_SAVED' }).catch(() => {});
      window.close();
    } else {
      alert('저장에 실패했습니다.');
    }
  });
});
