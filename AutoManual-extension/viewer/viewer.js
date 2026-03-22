// ========================================
// viewer.js — Google Slides 스타일 편집 뷰어
// 좌측 썸네일 | 중앙 이미지 | 우측 설명
// ========================================

const params = new URLSearchParams(location.search);
const title = params.get('title') || '매뉴얼';

let allSteps = [];
let selectedIndex = 0;
let viewerReRecordIndex = null;

// ── 초기 로드 ──
loadAndRender();

function loadAndRender(retries) {
  if (retries === undefined) retries = 5;
  chrome.runtime.sendMessage({ type: 'GET_STEPS' }, (response) => {
    if (chrome.runtime.lastError || !response?.steps?.length) {
      if (retries > 0) { setTimeout(() => loadAndRender(retries - 1), 400); return; }
      document.getElementById('canvasEmpty').style.display = 'block';
      document.getElementById('mainImage').style.display = 'none';
      document.getElementById('descPanel').style.display = 'none';
      document.getElementById('resizeHandleH').style.display = 'none';
      return;
    }
    allSteps = response.steps;
    document.title = `${title} — 편집`;
    if (selectedIndex >= allSteps.length) selectedIndex = allSteps.length - 1;
    if (selectedIndex < 0) selectedIndex = 0;
    renderSidebar();
    renderMain();
  });
}

// ══════════════════════════════════════
// 좌측 사이드바
// ══════════════════════════════════════
let dragFrom = null;

// 이전/다음 버튼
document.getElementById('prevStepBtn').addEventListener('click', () => {
  if (selectedIndex > 0) { selectedIndex--; renderSidebar(); renderMain(); }
});
document.getElementById('nextStepBtn').addEventListener('click', () => {
  if (selectedIndex < allSteps.length - 1) { selectedIndex++; renderSidebar(); renderMain(); }
});

function updatePageIndicator() {
  document.getElementById('pageIndicator').textContent =
    allSteps.length > 0 ? `${selectedIndex + 1} / ${allSteps.length}` : '0 / 0';
}

// 사이드바 접기/펼치기
const sidebar = document.getElementById('sidebar');
const sidebarToggle = document.getElementById('sidebarToggle');
sidebarToggle.addEventListener('click', () => {
  sidebar.classList.toggle('collapsed');
  sidebarToggle.classList.toggle('collapsed');
  sidebarToggle.textContent = sidebar.classList.contains('collapsed') ? '▶' : '◀';
});

function renderSidebar() {
  const list = document.getElementById('sidebarList');
  list.innerHTML = '';
  document.getElementById('slideCount').textContent = allSteps.length;

  allSteps.forEach((step, i) => {
    const item = document.createElement('div');
    item.className = 'slide-thumb' + (i === selectedIndex ? ' active' : '');
    item.draggable = true;
    item.dataset.index = i;

    const num = document.createElement('span');
    num.className = 'slide-thumb-num';
    num.textContent = i + 1;

    const img = document.createElement('img');
    img.src = step.screenshotWithMarker;
    img.draggable = false;

    item.appendChild(num);
    item.appendChild(img);

    if (step.modified) {
      const mod = document.createElement('span');
      mod.className = 'slide-thumb-modified';
      mod.textContent = step.changeType === 're-recorded' ? '🔄' : '✏️';
      item.appendChild(mod);
    }

    item.addEventListener('click', () => {
      selectedIndex = i;
      renderSidebar();
      renderMain();
    });

    // 드래그 순서 변경
    item.addEventListener('dragstart', (e) => {
      dragFrom = i;
      item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', i);
    });
    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      list.querySelectorAll('.dragover').forEach(el => el.classList.remove('dragover'));
      dragFrom = null;
    });
    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (dragFrom !== null && dragFrom !== i) item.classList.add('dragover');
    });
    item.addEventListener('dragleave', () => item.classList.remove('dragover'));
    item.addEventListener('drop', (e) => {
      e.preventDefault();
      item.classList.remove('dragover');
      if (dragFrom !== null && dragFrom !== i) {
        selectedIndex = i;
        chrome.runtime.sendMessage({ type: 'MOVE_STEP', from: dragFrom, to: i }, () => loadAndRender());
      }
    });

    list.appendChild(item);
  });

  setTimeout(() => {
    const active = list.querySelector('.active');
    if (active) active.scrollIntoView({ block: 'nearest' });
  }, 50);
}

// ══════════════════════════════════════
// 우측 메인 영역
// ══════════════════════════════════════
function renderMain() {
  updatePageIndicator();
  const step = allSteps[selectedIndex];
  if (!step) {
    document.getElementById('canvasEmpty').style.display = 'block';
    document.getElementById('mainImage').style.display = 'none';
    document.getElementById('descPanel').style.display = 'none';
    document.getElementById('resizeHandleH').style.display = 'none';
    return;
  }

  const img = document.getElementById('mainImage');
  img.src = step.screenshotWithMarker;
  img.style.display = 'block';
  img.onclick = () => openImageModal(step.screenshotWithMarker);
  img.style.cursor = 'zoom-in';
  document.getElementById('canvasEmpty').style.display = 'none';

  const titleInput = document.getElementById('slideTitle');
  titleInput.value = step.slideTitle || '';
  titleInput.onchange = () => {
    chrome.runtime.sendMessage({ type: 'UPDATE_SLIDE_TITLE', index: selectedIndex, slideTitle: titleInput.value });
  };

  renderDescPanel(step, selectedIndex);
}

function renderDescPanel(step, si) {
  const panel = document.getElementById('descPanel');
  const handle = document.getElementById('resizeHandleH');
  const body = document.getElementById('descPanelBody');

  let markers = Array.isArray(step.markers) && step.markers.length > 0
    ? step.markers
    : [{ number: 1, element: step.element || { tag: '', text: '' }, description: step.description || '' }];

  // 텍스트/넘버링/이미지 제외
  const filtered = markers.filter(m => {
    const tag = m.element?.tag;
    return tag !== 'text' && tag !== 'numbering' && tag !== 'image';
  });

  const displayMarkers = filtered.length > 0 ? filtered : markers;

  // 항상 설명 패널 표시
  panel.style.display = 'flex';
  handle.style.display = 'flex';
  body.innerHTML = '';

  if (displayMarkers.length === 0 || (displayMarkers.length === 1 && !displayMarkers[0].description && !step.description)) {
    body.innerHTML = '<div class="desc-empty">마커를 추가하면 설명을 입력할 수 있습니다</div>';
    return;
  }

  let dragMarkerFrom = null;

  displayMarkers.forEach((marker, mi) => {
    const row = document.createElement('div');
    row.className = 'marker-row';
    row.draggable = true;

    row.addEventListener('dragstart', (e) => {
      dragMarkerFrom = mi;
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      body.querySelectorAll('.dragover').forEach(r => r.classList.remove('dragover'));
    });
    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (dragMarkerFrom !== null && dragMarkerFrom !== mi) row.classList.add('dragover');
    });
    row.addEventListener('dragleave', () => row.classList.remove('dragover'));
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      row.classList.remove('dragover');
      if (dragMarkerFrom !== null && dragMarkerFrom !== mi) {
        const order = displayMarkers.map((_, i) => i);
        const [moved] = order.splice(dragMarkerFrom, 1);
        order.splice(mi, 0, moved);
        chrome.runtime.sendMessage({ type: 'REORDER_MARKERS', stepIndex: si, newOrder: order }, () => loadAndRender());
      }
    });

    const rowLeft = document.createElement('div');
    rowLeft.className = 'marker-row-left';

    const dragHandle = document.createElement('span');
    dragHandle.className = 'marker-drag-handle';
    dragHandle.textContent = '⠿';
    rowLeft.appendChild(dragHandle);

    const badge = document.createElement('span');
    badge.className = 'marker-badge';
    badge.textContent = mi + 1;
    rowLeft.appendChild(badge);

    if (displayMarkers.length > 1) {
      const del = document.createElement('button');
      del.className = 'marker-del-btn';
      del.textContent = '삭제';
      del.addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'DELETE_MARKER', stepIndex: si, markerIndex: mi }, () => loadAndRender());
      });
      rowLeft.appendChild(del);
    }

    const ta = document.createElement('textarea');
    ta.className = 'marker-desc-input';
    ta.value = marker.description || '';
    ta.placeholder = `${mi + 1}번 마커 설명...`;
    ta.rows = 1;
    ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; });
    ta.addEventListener('change', () => {
      chrome.runtime.sendMessage({ type: 'UPDATE_MARKER_DESC', stepIndex: si, markerIndex: mi, description: ta.value });
    });
    setTimeout(() => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; }, 10);

    row.appendChild(rowLeft);
    row.appendChild(ta);
    body.appendChild(row);
  });
}

// ══════════════════════════════════════
// 리사이즈 핸들 (이미지 ↔ 설명 패널)
// ══════════════════════════════════════
const resizeHandle = document.getElementById('resizeHandleH');
const descPanel = document.getElementById('descPanel');
const contentArea = document.getElementById('contentArea');
let isResizing = false;

resizeHandle.addEventListener('mousedown', (e) => {
  isResizing = true;
  resizeHandle.classList.add('active');
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
  e.preventDefault();
});

window.addEventListener('mousemove', (e) => {
  if (!isResizing) return;
  const contentRect = contentArea.getBoundingClientRect();
  const newWidth = contentRect.right - e.clientX;
  const clamped = Math.max(180, Math.min(500, newWidth));
  descPanel.style.width = clamped + 'px';
});

window.addEventListener('mouseup', () => {
  if (isResizing) {
    isResizing = false;
    resizeHandle.classList.remove('active');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }
});

// ══════════════════════════════════════
// 키보드 네비게이션
// ══════════════════════════════════════
document.addEventListener('keydown', (e) => {
  if (editorModal) return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  if (e.key === 'ArrowUp' || e.key === 'PageUp') {
    e.preventDefault();
    if (selectedIndex > 0) { selectedIndex--; renderSidebar(); renderMain(); }
  }
  if (e.key === 'ArrowDown' || e.key === 'PageDown') {
    e.preventDefault();
    if (selectedIndex < allSteps.length - 1) { selectedIndex++; renderSidebar(); renderMain(); }
  }
  if (e.key === 'Delete' && !e.ctrlKey && !e.metaKey) {
    document.getElementById('deleteStepBtn').click();
  }
});

// ══════════════════════════════════════
// 편집기 모달
// ══════════════════════════════════════
let editorModal = null;

document.getElementById('openEditorBtn').addEventListener('click', () => {
  if (allSteps.length === 0) return;
  openEditorModal(selectedIndex);
});

function openEditorModal(stepIndex) {
  if (editorModal) editorModal.remove();
  const overlay = document.createElement('div');
  overlay.className = 'editor-modal-overlay';
  const modal = document.createElement('div');
  modal.className = 'editor-modal';
  const iframe = document.createElement('iframe');
  iframe.src = chrome.runtime.getURL('editor/editor.html') + '?step=' + stepIndex;
  iframe.className = 'editor-modal-iframe';
  modal.appendChild(iframe);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  editorModal = overlay;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeEditorModal(); });
  function onEsc(e) { if (e.key === 'Escape') { closeEditorModal(); document.removeEventListener('keydown', onEsc); } }
  document.addEventListener('keydown', onEsc);
}

function closeEditorModal() {
  if (editorModal) { editorModal.remove(); editorModal = null; loadAndRender(); }
}

window.addEventListener('message', (e) => {
  if (e.data?.type === 'EDITOR_MODAL_CLOSE') closeEditorModal();
});

// ══════════════════════════════════════
// 삭제 / 닫기
// ══════════════════════════════════════
document.getElementById('duplicateStepBtn').addEventListener('click', () => {
  if (allSteps.length === 0) return;
  chrome.runtime.sendMessage({ type: 'DUPLICATE_STEP', index: selectedIndex }, (response) => {
    if (response?.success) {
      selectedIndex = response.newIndex;
      loadAndRender();
    }
  });
});

document.getElementById('deleteStepBtn').addEventListener('click', () => {
  if (allSteps.length === 0) return;
  if (!confirm(`Step ${selectedIndex + 1}을 삭제하시겠습니까?`)) return;
  chrome.runtime.sendMessage({ type: 'DELETE_STEP', index: selectedIndex }, () => {
    if (selectedIndex >= allSteps.length - 1) selectedIndex = Math.max(0, selectedIndex - 1);
    loadAndRender();
  });
});

document.getElementById('closeViewerBtn').addEventListener('click', () => window.close());

// ══════════════════════════════════════
// 재녹화 배너
// ══════════════════════════════════════
function createReRecordBanner() {
  if (document.getElementById('viewerReRecordBanner')) return;
  const banner = document.createElement('div');
  banner.id = 'viewerReRecordBanner';
  banner.className = 'viewer-re-record-banner';
  banner.style.display = 'none';
  banner.innerHTML = `
    <span id="viewerReRecordMsg">재녹화 중...</span>
    <div class="viewer-re-record-btns">
      <button id="viewerReRecordFinish" class="viewer-re-record-finish" style="display:none;">완료</button>
      <button id="viewerReRecordCancel" class="viewer-re-record-cancel">취소</button>
    </div>
  `;
  document.body.insertBefore(banner, document.body.firstChild);
  document.getElementById('viewerReRecordCancel').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'CANCEL_RE_RECORD' }, () => {
      viewerReRecordIndex = null; banner.style.display = 'none';
    });
  });
  document.getElementById('viewerReRecordFinish').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'FINISH_RE_RECORD' }, (response) => {
      viewerReRecordIndex = null; banner.style.display = 'none';
      if (response?.success) loadAndRender();
    });
  });
}

// ══════════════════════════════════════
// 메시지 수신
// ══════════════════════════════════════
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'EDITOR_SAVED') loadAndRender();
  if (message.type === 'STEPS_REORDERED') loadAndRender();
  if (message.type === 'RE_RECORD_PROGRESS') {
    const msg = document.getElementById('viewerReRecordMsg');
    const fin = document.getElementById('viewerReRecordFinish');
    if (msg) msg.textContent = `Step ${message.stepIndex + 1} 재녹화 중 — ${message.capturedCount}장 캡처됨`;
    if (fin) fin.style.display = 'inline-block';
  }
  if (message.type === 'RE_RECORD_DONE') {
    viewerReRecordIndex = null;
    const banner = document.getElementById('viewerReRecordBanner');
    if (banner) banner.style.display = 'none';
    loadAndRender();
  }
});

// ══════════════════════════════════════
// 이미지 확대 모달
// ══════════════════════════════════════
function openImageModal(src) {
  const existing = document.getElementById('imgModal');
  if (existing) { existing.querySelector('.modal-img').src = src; existing.style.display = 'flex'; return; }

  const modal = document.createElement('div');
  modal.id = 'imgModal';
  modal.style.cssText = `
    position:fixed;top:0;left:0;right:0;bottom:0;
    background:rgba(0,0,0,0.9);z-index:99999;
    display:flex;align-items:center;justify-content:center;
    flex-direction:column;
  `;

  const imgWrap = document.createElement('div');
  imgWrap.style.cssText = 'flex:1;display:flex;align-items:center;justify-content:center;width:100%;overflow:hidden;cursor:grab;';

  const img = document.createElement('img');
  img.className = 'modal-img';
  img.src = src;
  img.draggable = false;
  img.style.cssText = 'max-width:95%;max-height:90%;border-radius:4px;transition:transform 0.1s;user-select:none;';

  let scale = 1, panX = 0, panY = 0, dragging = false, dx, dy, spx, spy;
  function update() { img.style.transform = `translate(${panX}px,${panY}px) scale(${scale})`; ctrl.querySelector('span').textContent = Math.round(scale*100)+'%'; }

  imgWrap.addEventListener('wheel', (e) => { e.preventDefault(); scale = Math.min(8, Math.max(0.2, scale + (e.deltaY > 0 ? -0.15 : 0.15))); update(); });
  imgWrap.addEventListener('mousedown', (e) => { if (scale <= 1) return; dragging = true; dx = e.clientX; dy = e.clientY; spx = panX; spy = panY; imgWrap.style.cursor = 'grabbing'; e.preventDefault(); });
  window.addEventListener('mousemove', (e) => { if (!dragging) return; panX = spx + e.clientX - dx; panY = spy + e.clientY - dy; update(); });
  window.addEventListener('mouseup', () => { dragging = false; imgWrap.style.cursor = scale > 1 ? 'grab' : 'default'; });

  const ctrl = document.createElement('div');
  ctrl.style.cssText = 'position:fixed;bottom:12px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:8px;background:rgba(0,0,0,0.6);padding:6px 14px;border-radius:20px;z-index:100000;';
  ctrl.innerHTML = '<button style="width:28px;height:28px;border:none;border-radius:50%;background:rgba(255,255,255,0.2);color:#fff;font-size:15px;cursor:pointer;">−</button><span style="color:#aaa;font-size:12px;min-width:44px;text-align:center;">100%</span><button style="width:28px;height:28px;border:none;border-radius:50%;background:rgba(255,255,255,0.2);color:#fff;font-size:15px;cursor:pointer;">+</button><button style="padding:4px 10px;border:none;border-radius:12px;background:rgba(255,255,255,0.2);color:#fff;font-size:11px;cursor:pointer;">1:1</button>';
  const btns = ctrl.querySelectorAll('button');
  btns[0].onclick = (e) => { e.stopPropagation(); scale = Math.max(0.2, scale - 0.25); update(); };
  btns[1].onclick = (e) => { e.stopPropagation(); scale = Math.min(8, scale + 0.25); update(); };
  btns[2].onclick = (e) => { e.stopPropagation(); scale = 1; panX = 0; panY = 0; update(); };
  ctrl.onclick = (e) => e.stopPropagation();

  imgWrap.appendChild(img);
  modal.appendChild(imgWrap);
  modal.appendChild(ctrl);
  modal.addEventListener('click', (e) => { if (e.target === modal || e.target === imgWrap) modal.style.display = 'none'; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modal.style.display !== 'none') modal.style.display = 'none'; });
  document.body.appendChild(modal);
}

// ── 유틸 ──
function esc(text) {
  const d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}
