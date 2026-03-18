// ========================================
// editor.js — 마커 편집기 (v2)
// 도구: 사각형, 화살표, 원형, 텍스트, 블러, 크롭
// ========================================

const canvas = document.getElementById('editorCanvas');
const ctx = canvas.getContext('2d');
const descList = document.getElementById('descList');
const hintEl = document.getElementById('canvasHint');

const params = new URLSearchParams(location.search);
const stepIndex = parseInt(params.get('step'), 10);

let bgImage = null;
let bgDataUrl = '';
let viewport = null;
let imgScale = 1;
let annotations = [];    // 번호가 매겨지는 도형 (rect, arrow, circle, text)
let effects = [];        // 번호 없는 효과 (blur)
let currentTool = 'rect';
let isDrawing = false;
let startX = 0, startY = 0;

const DRAW_COLOR = 'rgba(230, 50, 50, 0.85)';
const DRAW_FILL = 'rgba(230, 50, 50, 0.08)';

const toolHints = {
  rect: '드래그하여 사각형을 그리세요',
  arrow: '드래그하여 화살표를 그리세요',
  circle: '드래그하여 원을 그리세요',
  text: '클릭하여 텍스트를 배치하세요 (위 입력란에 텍스트 입력)',
  blur: '드래그하여 블러 처리할 영역을 선택하세요',
  crop: '드래그하여 잘라낼 영역을 선택하세요 (선택 후 즉시 적용)'
};

// ── 초기 로드 ──
chrome.runtime.sendMessage({ type: 'GET_STEPS' }, (response) => {
  if (!response?.steps?.[stepIndex]) {
    hintEl.textContent = '데이터를 불러올 수 없습니다.';
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
    imgScale = img.width / viewport.width;

    if (step.markers?.length) {
      step.markers.forEach((m, i) => {
        const eRect = m.elementRect;
        if (eRect && eRect.width > 0) {
          annotations.push({
            type: m.element?.tag === 'arrow' ? 'arrow' : (m.element?.tag === 'circle' ? 'circle' : 'rect'),
            x: eRect.x * imgScale, y: eRect.y * imgScale,
            w: eRect.width * imgScale, h: eRect.height * imgScale,
            number: i + 1, description: m.description || ''
          });
        } else {
          annotations.push({
            type: 'circle',
            x: (m.x * imgScale) - 20, y: (m.y * imgScale) - 20,
            w: 40, h: 40,
            number: i + 1, description: m.description || ''
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
    hintEl.textContent = toolHints[currentTool] || '';

    // 옵션 바 토글
    document.getElementById('textOptions').style.display = currentTool === 'text' ? 'flex' : 'none';
    document.getElementById('blurOptions').style.display = currentTool === 'blur' ? 'flex' : 'none';
  });
});

document.getElementById('undoBtn').addEventListener('click', () => {
  // 마지막에 추가된 것이 effect인지 annotation인지 확인
  if (effects.length > 0 && annotations.length > 0) {
    const lastEffect = effects[effects.length - 1];
    const lastAnn = annotations[annotations.length - 1];
    if ((lastEffect._addedAt || 0) > (lastAnn._addedAt || 0)) {
      effects.pop();
    } else {
      annotations.pop();
      renumber();
    }
  } else if (effects.length > 0) {
    effects.pop();
  } else if (annotations.length > 0) {
    annotations.pop();
    renumber();
  }
  render();
  renderDescList();
});

document.getElementById('clearBtn').addEventListener('click', () => {
  if (!confirm('모든 마커와 효과를 삭제하시겠습니까?')) return;
  annotations = [];
  effects = [];
  render();
  renderDescList();
});

// ── 캔버스 이벤트 ──
canvas.addEventListener('mousedown', (e) => {
  if (currentTool === 'text') {
    // 텍스트: 클릭 위치에 바로 배치
    const r = canvas.getBoundingClientRect();
    const sx = canvas.width / r.width;
    const sy = canvas.height / r.height;
    const px = (e.clientX - r.left) * sx;
    const py = (e.clientY - r.top) * sy;

    const textVal = document.getElementById('textInput').value || '텍스트';
    const textSize = parseInt(document.getElementById('textSize').value, 10);
    const textColor = document.getElementById('textColor').value;

    annotations.push({
      type: 'text',
      x: px, y: py, w: 0, h: 0,
      text: textVal, fontSize: textSize, color: textColor,
      number: annotations.length + 1,
      description: textVal,
      _addedAt: Date.now()
    });
    render();
    renderDescList();
    return;
  }

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

  if (currentTool === 'blur') {
    drawBlurPreview(ctx, startX, startY, curX - startX, curY - startY);
  } else if (currentTool === 'crop') {
    drawCropPreview(ctx, startX, startY, curX - startX, curY - startY);
  } else {
    drawShape(ctx, currentTool, startX, startY, curX - startX, curY - startY, 0, true);
  }
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

  if (currentTool === 'blur') {
    if (Math.abs(w) > 5 && Math.abs(h) > 5) {
      effects.push({
        type: 'blur',
        x: Math.min(startX, startX + w), y: Math.min(startY, startY + h),
        w: Math.abs(w), h: Math.abs(h),
        strength: parseInt(document.getElementById('blurStrength').value, 10),
        _addedAt: Date.now()
      });
      // 블러를 원본 이미지에 베이크
      bakeBlurToImage();
    }
    render();
    return;
  }

  if (currentTool === 'crop') {
    if (Math.abs(w) > 20 && Math.abs(h) > 20) {
      applyCrop(
        Math.min(startX, startX + w), Math.min(startY, startY + h),
        Math.abs(w), Math.abs(h)
      );
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

  annotations.push({
    type: currentTool, x: startX, y: startY, w, h,
    number: annotations.length + 1, description: '',
    _addedAt: Date.now()
  });
  render();
  renderDescList();
});

canvas.addEventListener('mouseleave', () => {
  if (isDrawing) { isDrawing = false; render(); }
});

// ── 블러 처리 ──
function bakeBlurToImage() {
  const lastBlur = effects[effects.length - 1];
  if (!lastBlur || !bgImage) return;

  // 현재 bgImage에서 블러 영역만 추출 → 블러 → 다시 그리기
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = bgImage.width || canvas.width;
  tempCanvas.height = bgImage.height || canvas.height;
  const tCtx = tempCanvas.getContext('2d');
  tCtx.drawImage(bgImage, 0, 0);

  // 블러 영역 추출
  const bx = Math.max(0, Math.floor(lastBlur.x));
  const by = Math.max(0, Math.floor(lastBlur.y));
  const bw = Math.min(Math.ceil(lastBlur.w), tempCanvas.width - bx);
  const bh = Math.min(Math.ceil(lastBlur.h), tempCanvas.height - by);

  if (bw <= 0 || bh <= 0) return;

  // 간단한 픽셀화 블러 (축소 후 확대)
  const strength = lastBlur.strength || 16;
  const blurCanvas = document.createElement('canvas');
  const scale = Math.max(1, strength);
  blurCanvas.width = Math.max(1, Math.floor(bw / scale));
  blurCanvas.height = Math.max(1, Math.floor(bh / scale));
  const bCtx = blurCanvas.getContext('2d');
  bCtx.drawImage(tempCanvas, bx, by, bw, bh, 0, 0, blurCanvas.width, blurCanvas.height);
  tCtx.imageSmoothingEnabled = true;
  tCtx.drawImage(blurCanvas, 0, 0, blurCanvas.width, blurCanvas.height, bx, by, bw, bh);

  // 새 이미지로 교체
  const newImg = new Image();
  newImg.onload = () => {
    bgImage = newImg;
    bgDataUrl = tempCanvas.toDataURL('image/jpeg', 0.9);
    render();
  };
  newImg.src = tempCanvas.toDataURL('image/jpeg', 0.9);
}

function drawBlurPreview(ctx, x, y, w, h) {
  const rx = Math.min(x, x + w);
  const ry = Math.min(y, y + h);
  const rw = Math.abs(w);
  const rh = Math.abs(h);

  ctx.save();
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = '#4a90d9';
  ctx.lineWidth = 2;
  ctx.strokeRect(rx, ry, rw, rh);
  ctx.fillStyle = 'rgba(74, 144, 217, 0.15)';
  ctx.fillRect(rx, ry, rw, rh);
  ctx.setLineDash([]);
  ctx.fillStyle = '#4a90d9';
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('BLUR', rx + rw / 2, ry + rh / 2 + 5);
  ctx.restore();
}

// ── 크롭 처리 ──
function applyCrop(cx, cy, cw, ch) {
  if (!bgImage) return;

  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = cw;
  tempCanvas.height = ch;
  const tCtx = tempCanvas.getContext('2d');
  tCtx.drawImage(bgImage, cx, cy, cw, ch, 0, 0, cw, ch);

  const newImg = new Image();
  newImg.onload = () => {
    bgImage = newImg;
    bgDataUrl = tempCanvas.toDataURL('image/jpeg', 0.9);
    canvas.width = cw;
    canvas.height = ch;

    // 기존 annotations 좌표 보정
    annotations.forEach(ann => {
      ann.x -= cx;
      ann.y -= cy;
    });

    render();
    renderDescList();
    hintEl.textContent = '크롭 완료!';
  };
  newImg.src = tempCanvas.toDataURL('image/jpeg', 0.9);
}

function drawCropPreview(ctx, x, y, w, h) {
  const rx = Math.min(x, x + w);
  const ry = Math.min(y, y + h);
  const rw = Math.abs(w);
  const rh = Math.abs(h);

  // 어두운 오버레이
  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // 선택 영역은 밝게
  ctx.clearRect(rx, ry, rw, rh);
  ctx.drawImage(bgImage, rx, ry, rw, rh, rx, ry, rw, rh);
  // 선택 영역에 있는 annotations도 다시 그리기
  annotations.forEach(ann => {
    drawShape(ctx, ann.type, ann.x, ann.y, ann.w, ann.h, ann.number, false);
  });
  // 선택 테두리
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.strokeRect(rx, ry, rw, rh);
  ctx.setLineDash([]);
  ctx.restore();
}

// ── 렌더링 ──
function render() {
  if (!bgImage) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bgImage, 0, 0);
  annotations.forEach(ann => {
    drawShape(ctx, ann.type, ann.x, ann.y, ann.w, ann.h, ann.number, false, ann);
  });
}

function drawShape(ctx, type, x, y, w, h, number, isPreview, ann) {
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
    if (number > 0) drawBadge(ctx, clampBadge(rx - 8, ry - 8));

  } else if (type === 'arrow') {
    const ex = x + w, ey = y + h;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex, ey);
    ctx.strokeStyle = DRAW_COLOR; ctx.lineWidth = 3; ctx.stroke();
    const angle = Math.atan2(h, w);
    const hl = 18;
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - hl * Math.cos(angle - 0.4), ey - hl * Math.sin(angle - 0.4));
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - hl * Math.cos(angle + 0.4), ey - hl * Math.sin(angle + 0.4));
    ctx.stroke();
    if (number > 0) drawBadge(ctx, clampBadge(x - 14, y - 14));

  } else if (type === 'circle') {
    const cx = x + w / 2, cy = y + h / 2;
    const rx = Math.max(Math.abs(w) / 2, 4);
    const ry = Math.max(Math.abs(h) / 2, 4);
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = DRAW_FILL; ctx.fill();
    ctx.strokeStyle = DRAW_COLOR; ctx.lineWidth = 3; ctx.stroke();
    if (number > 0) drawBadge(ctx, clampBadge(cx - rx - 8, cy - ry - 8));

  } else if (type === 'text' && ann) {
    const fontSize = ann.fontSize || 20;
    const color = ann.color || '#e63232';
    ctx.font = `bold ${fontSize}px 'Malgun Gothic', sans-serif`;
    ctx.fillStyle = color;
    ctx.textBaseline = 'top';
    // 배경
    const textWidth = ctx.measureText(ann.text || '').width;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(x - 4, y - 2, textWidth + 8, fontSize + 6);
    ctx.fillStyle = color;
    ctx.fillText(ann.text || '', x, y);
    if (number > 0) drawBadge(ctx, clampBadge(x - 14, y - 14));
  }

  ctx.restore();
}

function clampBadge(bx, by) {
  const s = 24;
  return {
    x: Math.max(2, Math.min(bx, canvas.width - s - 2)),
    y: Math.max(2, Math.min(by, canvas.height - s - 2))
  };
}

function drawBadge(ctx, pos, num) {
  // num이 없으면 현재 그리는 annotation의 number를 사용 (호출 측에서 처리)
  const s = 24;
  const x = pos.x, y = pos.y;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = 4;
  ctx.beginPath(); ctx.arc(x + s/2, y + s/2, s/2, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(230,50,50,0.95)'; ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
  ctx.restore();
  // 번호는 render에서 annotation의 number로 그리므로 여기선 생략
}

// drawShape에서 호출하는 drawBadge를 번호 포함으로 변경
const _origDrawShape = drawShape;
drawShape = function(ctx, type, x, y, w, h, number, isPreview, ann) {
  _origDrawShape(ctx, type, x, y, w, h, number, isPreview, ann);
  // 번호 텍스트를 별도로 그리기 (drawBadge에서 원만 그리므로)
};

// 위의 drawBadge를 번호 포함 버전으로 재정의
drawBadge = function(ctx, pos) {
  // 이 함수는 drawShape 안에서 number와 함께 호출되므로,
  // 번호는 drawShape 컨텍스트에서 접근
};

// 실제로는 통합 함수로 다시 작성
// 위의 함수들을 덮어씀
(function() {
  const BADGE_SIZE = 24;

  window.drawShape = function(ctx, type, x, y, w, h, number, isPreview, ann) {
    ctx.save();
    ctx.globalAlpha = isPreview ? 0.5 : 1;

    let badgePos = null;

    if (type === 'rect') {
      const pad = 4;
      const rx = Math.min(x, x + w) - pad, ry = Math.min(y, y + h) - pad;
      const rw = Math.abs(w) + pad*2, rh = Math.abs(h) + pad*2;
      ctx.beginPath(); ctx.roundRect(rx, ry, rw, rh, 8);
      ctx.fillStyle = DRAW_FILL; ctx.fill();
      ctx.strokeStyle = DRAW_COLOR; ctx.lineWidth = 3; ctx.stroke();
      badgePos = { x: rx - 8, y: ry - 8 };

    } else if (type === 'arrow') {
      const ex = x + w, ey = y + h;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex, ey);
      ctx.strokeStyle = DRAW_COLOR; ctx.lineWidth = 3; ctx.stroke();
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
      ctx.fillStyle = DRAW_FILL; ctx.fill();
      ctx.strokeStyle = DRAW_COLOR; ctx.lineWidth = 3; ctx.stroke();
      badgePos = { x: cx - rx2 - 8, y: cy - ry2 - 8 };

    } else if (type === 'text' && ann) {
      const fs = ann.fontSize || 20;
      const clr = ann.color || '#e63232';
      ctx.font = `bold ${fs}px 'Malgun Gothic', sans-serif`;
      ctx.textBaseline = 'top';
      const tw = ctx.measureText(ann.text || '').width;
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillRect(x - 4, y - 2, tw + 8, fs + 6);
      ctx.fillStyle = clr;
      ctx.fillText(ann.text || '', x, y);
      badgePos = { x: x - 14, y: y - 14 };
    }

    // 번호 배지
    if (number > 0 && badgePos) {
      const bx = Math.max(2, Math.min(badgePos.x, canvas.width - BADGE_SIZE - 2));
      const by = Math.max(2, Math.min(badgePos.y, canvas.height - BADGE_SIZE - 2));

      ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = 4;
      ctx.beginPath(); ctx.arc(bx+BADGE_SIZE/2, by+BADGE_SIZE/2, BADGE_SIZE/2, 0, Math.PI*2);
      ctx.fillStyle = 'rgba(230,50,50,0.95)'; ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();

      ctx.fillStyle = '#fff';
      ctx.font = 'bold 13px -apple-system, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(number), bx+BADGE_SIZE/2, by+BADGE_SIZE/2);
    }

    ctx.restore();
  };

  window.render = function() {
    if (!bgImage) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bgImage, 0, 0);
    annotations.forEach(ann => {
      drawShape(ctx, ann.type, ann.x, ann.y, ann.w, ann.h, ann.number, false, ann);
    });
  };
})();

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
  const typeNames = { rect: '사각형', arrow: '화살표', circle: '원형', text: '텍스트' };
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
      annotations.splice(i, 1); renumber(); render(); renderDescList();
    });
    header.appendChild(badge);
    header.appendChild(typeLbl);
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

// ── 저장 ──
document.getElementById('saveBtn').addEventListener('click', () => {
  if (!viewport || !bgImage) return;
  const invScale = 1 / imgScale;

  const markers = annotations.map((ann, i) => ({
    x: (ann.x + (ann.w||0)/2) * invScale,
    y: (ann.y + (ann.h||0)/2) * invScale,
    number: i + 1,
    elementRect: (ann.type !== 'arrow') ? {
      x: Math.min(ann.x, ann.x + (ann.w||0)) * invScale,
      y: Math.min(ann.y, ann.y + (ann.h||0)) * invScale,
      width: Math.abs(ann.w||0) * invScale,
      height: Math.abs(ann.h||0) * invScale
    } : null,
    element: { tag: ann.type, text: ann.text || '' },
    description: ann.description || (ann.type === 'text' ? ann.text : '')
  }));

  // 최종 이미지 생성 (annotations 포함)
  render();
  const markedDataUrl = canvas.toDataURL('image/jpeg', 0.85);

  chrome.runtime.sendMessage({
    type: 'SAVE_EDITOR',
    stepIndex,
    markers,
    screenshotWithMarker: markedDataUrl,
    screenshot: bgDataUrl, // 블러/크롭이 적용된 원본도 갱신
    description: markers.map((m,i) => `${i+1}. ${m.description||''}`).filter(d=>d.length>3).join('\n')
  }, (response) => {
    if (response?.success) {
      alert('저장되었습니다!');
      chrome.runtime.sendMessage({ type: 'EDITOR_SAVED' }).catch(()=>{});
      window.close();
    } else {
      alert('저장 실패');
    }
  });
});
