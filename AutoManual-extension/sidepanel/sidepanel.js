// ========================================
// sidepanel.js — 사이드 패널 로직
// Chrome Extension CSP: 모든 이벤트를 addEventListener로 연결
// ========================================

const recordBtn = document.getElementById('recordBtn');
const recordBtnText = document.getElementById('recordBtnText');
const stepCount = document.getElementById('stepCount');
const stepList = document.getElementById('stepList');
const emptyState = document.getElementById('emptyState');
const bottomBar = document.getElementById('bottomBar');
const exportBtn = document.getElementById('exportBtn');
const exportMenu = document.getElementById('exportMenu');
const previewBtn = document.getElementById('previewBtn');
const modePerClick = document.getElementById('modePerClick');
const modePerPage = document.getElementById('modePerPage');
// modeHint는 compact UI에서 제거됨

let isRecording = false;
let reRecordStepIndex = null; // 재녹화 중인 단계 인덱스

// ─── 매뉴얼 저장/불러오기 ───
const saveManualBtn = document.getElementById('saveManualBtn');
const loadManualBtn = document.getElementById('loadManualBtn');
const manualListPanel = document.getElementById('manualListPanel');
const manualListBody = document.getElementById('manualListBody');
const manualListClose = document.getElementById('manualListClose');
const reRecordBanner = document.getElementById('reRecordBanner');
const reRecordMsg = document.getElementById('reRecordMsg');
const reRecordCancel = document.getElementById('reRecordCancel');
const reRecordFinish = document.getElementById('reRecordFinish');
const reRecordThumbs = document.getElementById('reRecordThumbs');

saveManualBtn.addEventListener('click', () => {
  const title = document.getElementById('manualTitle').value || '제목 없음';
  chrome.runtime.sendMessage({ type: 'GET_STEPS' }, (res) => {
    if (!res?.steps?.length) {
      alert('저장할 단계가 없습니다.');
      return;
    }
    chrome.runtime.sendMessage({ type: 'SAVE_MANUAL', title }, (response) => {
      if (response?.success) {
        alert(`"${title}" 매뉴얼이 저장되었습니다.`);
      }
    });
  });
});

loadManualBtn.addEventListener('click', () => {
  if (manualListPanel.style.display === 'none') {
    manualListPanel.style.display = 'block';
    refreshManualList();
  } else {
    manualListPanel.style.display = 'none';
  }
});

manualListClose.addEventListener('click', () => {
  manualListPanel.style.display = 'none';
});

function refreshManualList() {
  chrome.runtime.sendMessage({ type: 'GET_MANUALS' }, (response) => {
    const manuals = response?.manuals || [];
    manualListBody.innerHTML = '';
    if (manuals.length === 0) {
      manualListBody.innerHTML = '<p class="manual-list-empty">저장된 매뉴얼이 없습니다</p>';
      return;
    }
    manuals.forEach(m => {
      const item = document.createElement('div');
      item.className = 'manual-list-item';

      const info = document.createElement('div');
      info.className = 'manual-item-info';
      const titleEl = document.createElement('div');
      titleEl.className = 'manual-item-title';
      titleEl.textContent = m.title;
      const meta = document.createElement('div');
      meta.className = 'manual-item-meta';
      meta.textContent = `${new Date(m.savedAt).toLocaleString('ko-KR')} · ${m.stepCount}단계`;
      info.appendChild(titleEl);
      info.appendChild(meta);

      const actions = document.createElement('div');
      actions.className = 'manual-item-actions';
      const delBtn = document.createElement('button');
      delBtn.className = 'manual-item-del';
      delBtn.textContent = '🗑️';
      delBtn.title = '삭제';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!confirm(`"${m.title}" 매뉴얼을 삭제하시겠습니까?`)) return;
        chrome.runtime.sendMessage({ type: 'DELETE_MANUAL', manualId: m.id }, () => {
          refreshManualList();
        });
      });
      actions.appendChild(delBtn);

      item.appendChild(info);
      item.appendChild(actions);
      item.addEventListener('click', () => loadManual(m.id));
      manualListBody.appendChild(item);
    });
  });
}

function loadManual(manualId) {
  if (!confirm('현재 작업을 대체하고 저장된 매뉴얼을 불러오시겠습니까?')) return;
  chrome.runtime.sendMessage({ type: 'LOAD_MANUAL', manualId }, (response) => {
    if (response?.success) {
      document.getElementById('manualTitle').value = response.title || '';
      manualListPanel.style.display = 'none';
      refreshStepList(response.steps);
    } else {
      alert(response?.error || '불러오기 실패');
    }
  });
}

// ─── 재녹화 컨트롤 ───
reRecordCancel.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'CANCEL_RE_RECORD' }, () => {
    reRecordStepIndex = null;
    reRecordBanner.style.display = 'none';
    reRecordFinish.style.display = 'none';
    reRecordThumbs.innerHTML = '';
  });
});

reRecordFinish.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'FINISH_RE_RECORD' }, (response) => {
    reRecordStepIndex = null;
    reRecordBanner.style.display = 'none';
    reRecordFinish.style.display = 'none';
    reRecordThumbs.innerHTML = '';
    if (response?.success) {
      refreshStepList(response.steps);
    } else {
      alert(response?.error || '재녹화 완료 실패');
    }
  });
});

function startReRecord(stepIndex) {
  if (isRecording) {
    alert('녹화 중에는 재녹화를 시작할 수 없습니다.');
    return;
  }
  const titleVal = document.getElementById('manualTitle').value.trim();
  if (!titleVal) {
    alert('매뉴얼 제목을 입력해주세요.');
    document.getElementById('manualTitle').focus();
    return;
  }
  reRecordStepIndex = stepIndex;
  reRecordMsg.textContent = `Step ${stepIndex + 1} 재녹화 중`;
  reRecordBanner.style.display = 'block';
  reRecordFinish.style.display = 'none';
  reRecordThumbs.innerHTML = '';
  chrome.runtime.sendMessage({ type: 'START_RE_RECORD', stepIndex });
}

// ─── 사용법 팝업 ───
const helpBtn = document.getElementById('helpBtn');
const helpOverlay = document.getElementById('helpOverlay');
const helpCloseBtn = document.getElementById('helpCloseBtn');

helpBtn.addEventListener('click', () => {
  helpOverlay.style.display = 'flex';
});

helpCloseBtn.addEventListener('click', () => {
  helpOverlay.style.display = 'none';
});

helpOverlay.addEventListener('click', (e) => {
  if (e.target === helpOverlay) helpOverlay.style.display = 'none';
});

// ─── 캡처 모드 전환 ───
const modeHints = {
  'per-click': '클릭할 때마다 새 스크린샷을 캡처합니다',
  'per-page': '같은 화면의 여러 클릭을 하나의 스크린샷에 모아 표시합니다'
};

modePerClick.addEventListener('click', () => setMode('per-click'));
modePerPage.addEventListener('click', () => setMode('per-page'));

function setMode(mode) {
  modePerClick.classList.toggle('active', mode === 'per-click');
  modePerPage.classList.toggle('active', mode === 'per-page');
  // modeHint 제거됨 (compact UI)
  chrome.runtime.sendMessage({ type: 'SET_CAPTURE_MODE', mode });
}

// ─── 초기화 ───
chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
  if (response) {
    isRecording = response.isRecording;
    updateRecordButton();
    if (response.stepCount > 0) {
      loadSteps();
    }
  }
});

// ─── 녹화 시작/중지 ───
// background.js가 모든 탭에 녹화 상태를 직접 전파하므로
// sidepanel에서는 UI만 업데이트
recordBtn.addEventListener('click', () => {
  if (!isRecording) {
    const titleVal = document.getElementById('manualTitle').value.trim();
    if (!titleVal) {
      alert('매뉴얼 제목을 입력해주세요.');
      document.getElementById('manualTitle').focus();
      return;
    }
    // 캡처 모드를 클릭당 1장으로 리셋
    setMode('per-click');
    chrome.runtime.sendMessage({ type: 'START_RECORDING' }, (response) => {
      if (response?.success) {
        isRecording = true;
        updateRecordButton();
        clearStepList();
      }
    });
  } else {
    chrome.runtime.sendMessage({ type: 'STOP_RECORDING' }, (response) => {
      if (response?.success) {
        isRecording = false;
        updateRecordButton();
      }
    });
  }
});

function updateRecordButton() {
  if (isRecording) {
    recordBtn.classList.add('recording');
    recordBtnText.textContent = '녹화 중지';
  } else {
    recordBtn.classList.remove('recording');
    recordBtnText.textContent = '녹화 시작';
  }
}

// ─── 새 단계 / 업데이트 수신 ───
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'NEW_STEP') {
    addStepCard(message.step);
    updateStepCount();
  }
  if (message.type === 'UPDATE_STEP') {
    // 화면당 1장 모드: 전체 목록을 새로고침하여 마커 목록도 갱신
    refreshStepListFromBg();
  }
  // 편집기에서 저장 완료 → 사이드 패널 새로고침
  if (message.type === 'EDITOR_SAVED') {
    refreshStepListFromBg();
  }
  // 재녹화 진행 (캡처 추가될 때마다)
  if (message.type === 'RE_RECORD_PROGRESS') {
    reRecordMsg.textContent = `Step ${message.stepIndex + 1} 재녹화 중 — ${message.capturedCount}장 캡처됨`;
    reRecordFinish.style.display = 'inline-block';

    if (message.thumbnail) {
      if (message.merged) {
        // 화면당 1장: 마지막 썸네일 업데이트
        const lastThumb = reRecordThumbs.querySelector('.re-record-thumb-label:last-child img');
        if (lastThumb) {
          lastThumb.src = message.thumbnail;
        }
      } else {
        // 새 장 추가
        const thumbWrap = document.createElement('div');
        thumbWrap.className = 're-record-thumb-label';
        const img = document.createElement('img');
        img.className = 're-record-thumb';
        img.src = message.thumbnail;
        img.alt = `캡처 ${message.capturedCount}`;
        const label = document.createElement('span');
        label.className = 're-record-thumb-num';
        label.textContent = `${message.capturedCount}장`;
        thumbWrap.appendChild(img);
        thumbWrap.appendChild(label);
        reRecordThumbs.appendChild(thumbWrap);
      }
    }
  }
  // 재녹화 완료 (FINISH_RE_RECORD 응답으로도 처리됨, 이건 broadcast 수신용)
  if (message.type === 'RE_RECORD_DONE') {
    reRecordStepIndex = null;
    reRecordBanner.style.display = 'none';
    reRecordFinish.style.display = 'none';
    if (message.steps) {
      refreshStepList(message.steps);
    } else {
      refreshStepListFromBg();
    }
  }
});

// ─── 단계 목록 관리 ───
function clearStepList() {
  stepList.innerHTML = '';
  stepList.appendChild(emptyState);
  emptyState.style.display = 'block';
  bottomBar.style.display = 'none';
  stepCount.textContent = '0 단계';
}

function loadSteps() {
  chrome.runtime.sendMessage({ type: 'GET_STEPS' }, (response) => {
    if (response?.steps?.length > 0) {
      emptyState.style.display = 'none';
      response.steps.forEach(addStepCard);
      updateStepCount();
    }
  });
}

// ─── 드래그 앤 드롭 상태 ───
let dragSrcIndex = null;
let lastMovedIndex = null; // 위/아래 버튼으로 이동한 카드 하이라이트용

function addStepCard(step) {
  emptyState.style.display = 'none';
  bottomBar.style.display = 'flex';

  const stepIndex = step.stepNumber - 1;
  const card = document.createElement('div');
  card.className = 'step-thumb-card' + (step.modified ? ' step-thumb-modified' : '');
  if (lastMovedIndex === stepIndex) card.classList.add('step-thumb-moving');
  card.dataset.index = stepIndex;
  card.draggable = true;

  // ── 드래그 이벤트 ──
  card.addEventListener('dragstart', (e) => {
    dragSrcIndex = stepIndex;
    card.classList.add('step-thumb-dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', stepIndex);
  });

  card.addEventListener('dragend', () => {
    card.classList.remove('step-thumb-dragging');
    stepList.querySelectorAll('.step-thumb-card').forEach(c => c.classList.remove('step-thumb-dragover'));
    dragSrcIndex = null;
  });

  card.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragSrcIndex !== null && dragSrcIndex !== stepIndex) {
      card.classList.add('step-thumb-dragover');
    }
  });

  card.addEventListener('dragleave', () => {
    card.classList.remove('step-thumb-dragover');
  });

  card.addEventListener('drop', (e) => {
    e.preventDefault();
    card.classList.remove('step-thumb-dragover');
    const fromIndex = dragSrcIndex;
    if (fromIndex !== null && fromIndex !== stepIndex) {
      lastMovedIndex = null;
      moveStep(fromIndex, stepIndex);
    }
  });

  // ── 썸네일 이미지 ──
  const img = document.createElement('img');
  img.className = 'step-thumb-img';
  img.src = step.screenshotWithMarker;
  img.alt = `Step ${step.stepNumber}`;
  img.draggable = false; // 이미지 자체 드래그 방지
  img.addEventListener('click', () => openImageFullscreen(step.screenshotWithMarker));

  // ── 오버레이: Step 번호 ──
  const numBadge = document.createElement('span');
  numBadge.className = 'step-thumb-num';
  numBadge.textContent = step.stepNumber;

  // ── 수정됨 배지 ──
  if (step.modified) {
    const modBadge = document.createElement('span');
    modBadge.className = 'step-thumb-mod';
    modBadge.textContent = step.changeType === 're-recorded' ? '🔄' : '✏️';
    card.appendChild(modBadge);
  }

  // ── 하단 액션 바 ──
  const actionBar = document.createElement('div');
  actionBar.className = 'step-thumb-actions';

  const reRecBtn = document.createElement('button');
  reRecBtn.textContent = '🔄';
  reRecBtn.title = '재녹화';
  reRecBtn.addEventListener('click', (e) => { e.stopPropagation(); startReRecord(stepIndex); });

  const editBtn = document.createElement('button');
  editBtn.textContent = '✏️';
  editBtn.title = '편집기';
  editBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const editorUrl = chrome.runtime.getURL('editor/editor.html') + '?step=' + stepIndex;
    chrome.tabs.create({ url: editorUrl });
  });

  const upBtn = document.createElement('button');
  upBtn.textContent = '↑';
  upBtn.title = '위로';
  upBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (stepIndex > 0) {
      lastMovedIndex = stepIndex - 1;
      moveStep(stepIndex, stepIndex - 1);
    }
  });

  const downBtn = document.createElement('button');
  downBtn.textContent = '↓';
  downBtn.title = '아래로';
  downBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    lastMovedIndex = stepIndex + 1;
    moveStep(stepIndex, stepIndex + 1);
  });

  const delBtn = document.createElement('button');
  delBtn.textContent = '✕';
  delBtn.title = '삭제';
  delBtn.className = 'step-thumb-del';
  delBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteStep(stepIndex); });

  actionBar.appendChild(reRecBtn);
  actionBar.appendChild(editBtn);
  actionBar.appendChild(upBtn);
  actionBar.appendChild(downBtn);
  actionBar.appendChild(delBtn);

  card.appendChild(img);
  card.appendChild(numBadge);
  card.appendChild(actionBar);

  stepList.appendChild(card);
  stepList.scrollTop = stepList.scrollHeight;
}

// 이동 하이라이트 자동 해제
function clearMovingHighlight() {
  setTimeout(() => {
    lastMovedIndex = null;
    stepList.querySelectorAll('.step-thumb-moving').forEach(c => c.classList.remove('step-thumb-moving'));
  }, 1500);
}

// background에서 최신 데이터 가져와서 목록 새로고침
function refreshStepListFromBg() {
  chrome.runtime.sendMessage({ type: 'GET_STEPS' }, (response) => {
    if (response?.steps) refreshStepList(response.steps);
  });
}

function updateStepCount() {
  const count = stepList.querySelectorAll('.step-thumb-card').length;
  stepCount.textContent = `${count} 단계`;
}

// ─── 전체 목록 새로고침 ───
function refreshStepList(stepsData) {
  stepList.querySelectorAll('.step-thumb-card').forEach((card) => card.remove());
  if (!stepsData || stepsData.length === 0) {
    emptyState.style.display = 'block';
    bottomBar.style.display = 'none';
  } else {
    emptyState.style.display = 'none';
    bottomBar.style.display = 'flex';
    stepsData.forEach(addStepCard);
  }
  updateStepCount();
}

// ─── 단계 삭제 ───
function deleteStep(index) {
  if (!confirm('이 단계를 삭제하시겠습니까?')) return;

  chrome.runtime.sendMessage({ type: 'DELETE_STEP', index }, (response) => {
    if (response?.success) refreshStepList(response.steps);
  });
}

// ─── 단계 순서 이동 ───
function moveStep(from, to) {
  chrome.runtime.sendMessage({ type: 'MOVE_STEP', from, to }, (response) => {
    if (response?.success) {
      refreshStepList(response.steps);
      clearMovingHighlight();
    }
  });
}

// ─── 설명 업데이트 ───
function updateDescription(index, description) {
  chrome.runtime.sendMessage({
    type: 'UPDATE_DESCRIPTION',
    index,
    description
  });
}

// ─── 이미지 풀스크린 보기 ───
function openImageFullscreen(src) {
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    background: rgba(0,0,0,0.9); z-index: 999999;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer;
  `;
  const img = document.createElement('img');
  img.src = src;
  img.style.cssText = 'max-width: 95%; max-height: 95%; border-radius: 8px;';
  overlay.appendChild(img);
  overlay.addEventListener('click', () => overlay.remove());
  document.body.appendChild(overlay);
}

// ─── 미리보기 (탭 재사용) ───
let previewTabId = null;

previewBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'GET_STEPS' }, (response) => {
    if (!response?.steps?.length) {
      alert('캡처된 단계가 없습니다.');
      return;
    }

    const title = document.getElementById('manualTitle').value || '매뉴얼';
    const viewerUrl = chrome.runtime.getURL('viewer/viewer.html')
      + '?title=' + encodeURIComponent(title);

    // 이미 열린 미리보기 탭이 있으면 재사용
    if (previewTabId !== null) {
      chrome.tabs.get(previewTabId, (tab) => {
        if (chrome.runtime.lastError || !tab) {
          // 탭이 닫혔으면 새로 열기
          previewTabId = null;
          openPreviewTab(viewerUrl);
        } else {
          // 기존 탭 업데이트 + 포커스
          chrome.tabs.update(previewTabId, { url: viewerUrl, active: true });
        }
      });
    } else {
      openPreviewTab(viewerUrl);
    }
  });
});

function openPreviewTab(url) {
  chrome.tabs.create({ url }, (tab) => {
    previewTabId = tab.id;
  });
}

// 미리보기 탭이 닫히면 ID 초기화
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === previewTabId) previewTabId = null;
});

// ─── 내보내기 드롭다운 ───
exportBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  exportMenu.classList.toggle('show');
});

document.addEventListener('click', () => {
  exportMenu.classList.remove('show');
});

// 내보내기 메뉴 버튼들에 이벤트 연결
exportMenu.querySelectorAll('button[data-format]').forEach((btn) => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const format = btn.dataset.format;
    exportMenu.classList.remove('show');
    exportAs(format);
  });
});

// ─── 내보내기 실행 ───
function exportAs(format) {
  chrome.runtime.sendMessage({ type: 'GET_STEPS' }, (response) => {
    if (!response?.steps?.length) {
      alert('캡처된 단계가 없습니다.');
      return;
    }

    const title = document.getElementById('manualTitle').value || '매뉴얼';
    const steps = response.steps;

    if (format === 'html') {
      exportToHTML(title, steps);
    } else if (format === 'pdf') {
      exportToPDF(title, steps);
    } else if (format === 'pptx') {
      exportToPPTX(title, steps);
    } else if (format === 'gif') {
      exportToGIF(title, steps);
    } else {
      alert(`${format.toUpperCase()} 내보내기는 다음 버전에서 지원됩니다.`);
    }
  });
}

// ─── HTML 내보내기 (좌측 캡처 + 우측 설명) ───
function exportToHTML(title, steps) {
  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Malgun Gothic', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      max-width: 1100px; margin: 0 auto; padding: 40px 20px;
      background: #e8ecf4; color: #1a1a2e;
    }
    h1 { font-size: 28px; margin-bottom: 8px; color: #1b2a4a; }
    .meta { color: #6b7b9e; font-size: 13px; margin-bottom: 32px; }
    .step { display: flex; background: #fff; border-radius: 12px; margin-bottom: 24px;
            overflow: hidden; box-shadow: 0 2px 8px rgba(27,42,74,0.08); border: 1px solid #c8d1e0; }
    .step.modified { border: 3px solid #7c3aed; box-shadow: 0 4px 20px rgba(124,58,237,0.2); }
    .change-banner { padding: 8px 18px; background: linear-gradient(90deg, #faf5ff, #ede9fe);
                     border-bottom: 2px solid #7c3aed; border-left: 4px solid #7c3aed;
                     font-size: 12px; color: #6d28d9; font-weight: 600; }
    .mod-badge { display: inline-block; font-size: 10px; font-weight: 700; color: #fff;
                 background: #7c3aed; padding: 2px 8px; border-radius: 8px; margin-left: 6px; }
    .step-left { flex: 7; min-width: 0; }
    .step-header { padding: 12px 18px; background: #1b2a4a;
                   display: flex; justify-content: space-between; align-items: center; }
    .step-num { font-weight: 700; color: #fff; font-size: 13px;
                background: #4a90d9; padding: 3px 12px; border-radius: 5px; }
    .step-url { font-size: 11px; color: #6b7b9e; }
    .step-left img { width: 100%; display: block; }
    .step-right { flex: 3; min-width: 200px; max-width: 320px;
                  background: #f4f6fa; border-left: 1px solid #c8d1e0;
                  display: flex; flex-direction: column; }
    .step-right-header { padding: 12px 16px; background: #2c3e6b;
                         font-size: 12px; font-weight: 700; color: #fff; text-align: center; }
    .step-desc { padding: 16px; font-size: 13px; line-height: 1.7; flex: 1; white-space: pre-wrap; }
    .marker-row { display: flex; align-items: flex-start; gap: 10px;
                  padding: 10px 14px; border-bottom: 1px solid #e8ecf4; }
    .marker-row:last-child { border-bottom: none; }
    .marker-badge { display: inline-flex; align-items: center; justify-content: center;
                    min-width: 22px; height: 22px; border-radius: 50%;
                    background: #e63232; color: #fff; font-size: 11px; font-weight: 700; flex-shrink: 0; }
    .marker-text { font-size: 13px; line-height: 1.6; color: #1a1a2e; }
    .footer { text-align: center; color: #6b7b9e; font-size: 12px;
              margin-top: 40px; padding: 24px; }
    @media (max-width: 768px) {
      .step { flex-direction: column; }
      .step-right { max-width: none; border-left: none; border-top: 1px solid #c8d1e0; }
    }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <div class="meta">작성일: ${new Date().toLocaleDateString('ko-KR')} | 총 ${steps.length}단계</div>
  ${steps.map(step => {
    const markers = step.markers || [];
    let descHtml;
    if (markers.length > 0) {
      descHtml = markers.map((m, i) => `
        <div class="marker-row">
          <span class="marker-badge">${i + 1}</span>
          <span class="marker-text">${escapeHtml(m.description || '(설명 없음)')}</span>
        </div>`).join('');
    } else {
      descHtml = `<div class="step-desc">${escapeHtml(step.description || '(설명 없음)')}</div>`;
    }
    const modClass = step.modified ? ' modified' : '';
    const modBadge = step.modified
      ? `<span class="mod-badge">${step.changeType === 're-recorded' ? '재녹화됨' : '수정됨'}</span>`
      : '';
    const changeBanner = step.modified && step.changeSummary
      ? `<div class="change-banner">${step.changeType === 're-recorded' ? '🔄' : '✏️'} ${escapeHtml(step.changeSummary)}${step.modifiedAt ? ' (' + new Date(step.modifiedAt).toLocaleString('ko-KR') + ')' : ''}</div>`
      : '';
    return `
  <div class="step${modClass}">
    <div class="step-left">
      <div class="step-header">
        <span class="step-num">Step ${step.stepNumber}${modBadge}</span>
        <span class="step-url">${escapeHtml(step.pageTitle || '')}</span>
      </div>
      ${changeBanner}
      <img src="${step.screenshotWithMarker}" alt="Step ${step.stepNumber}">
    </div>
    <div class="step-right">
      <div class="step-right-header">설명</div>
      ${descHtml}
    </div>
  </div>`;
  }).join('\n')}
  <div class="footer">DX-AutoManual으로 생성됨</div>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html; charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${title}.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ─── PDF 내보내기 (인쇄 다이얼로그) ───
function exportToPDF(title, steps) {
  if (typeof jspdf === 'undefined') {
    alert('PDF 라이브러리를 불러오지 못했습니다.');
    return;
  }

  const statusEl = document.createElement('div');
  statusEl.style.cssText = 'position:fixed;top:0;left:0;right:0;padding:12px;background:#1b2a4a;color:#fff;text-align:center;font-size:14px;z-index:99999;font-family:inherit;';
  statusEl.textContent = 'PDF 생성 중...';
  document.body.appendChild(statusEl);

  const { jsPDF } = jspdf;
  // 가로(landscape) A4: 297 x 210 mm
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const PW = 297, PH = 210;
  const M = 10; // 마진

  // === 표지 ===
  pdf.setFillColor(27, 42, 74);
  pdf.rect(0, 0, PW, PH, 'F');
  // 상단 장식선
  pdf.setFillColor(74, 144, 217);
  pdf.rect(0, 0, PW, 2, 'F');
  // 제목
  pdf.setTextColor(255, 255, 255);
  pdf.setFontSize(28);
  pdf.text(title, PW / 2, PH * 0.4, { align: 'center' });
  // 구분선
  pdf.setFillColor(74, 144, 217);
  pdf.rect(PW / 2 - 30, PH * 0.47, 60, 1, 'F');
  // 메타
  pdf.setFontSize(12);
  pdf.setTextColor(107, 123, 158);
  pdf.text(`${new Date().toLocaleDateString('ko-KR')}  |  ${steps.length} steps`, PW / 2, PH * 0.55, { align: 'center' });
  // 브랜딩
  pdf.setFontSize(9);
  pdf.setTextColor(74, 85, 104);
  pdf.text('DX-AutoManual', PW / 2, PH * 0.85, { align: 'center' });

  // === 각 단계 (1 step = 1 page) ===
  let loaded = 0;

  const addStepPages = async () => {
    for (let si = 0; si < steps.length; si++) {
      const step = steps[si];
      pdf.addPage('a4', 'landscape');

      // 배경
      pdf.setFillColor(232, 236, 244);
      pdf.rect(0, 0, PW, PH, 'F');

      // 상단 헤더 바
      pdf.setFillColor(27, 42, 74);
      pdf.rect(0, 0, PW, 14, 'F');

      // Step 번호 배지
      pdf.setFillColor(74, 144, 217);
      pdf.roundedRect(M, 3, 24, 8, 1.5, 1.5, 'F');
      pdf.setTextColor(255, 255, 255);
      pdf.setFontSize(9);
      pdf.text(`Step ${step.stepNumber}`, M + 12, 8.2, { align: 'center' });

      // 수정 배지
      if (step.modified) {
        const modLabel = step.changeType === 're-recorded' ? 'Re-recorded' : 'Edited';
        pdf.setFillColor(124, 58, 237);
        pdf.roundedRect(PW - M - 22, 3, 22, 8, 1.5, 1.5, 'F');
        pdf.setTextColor(255, 255, 255);
        pdf.setFontSize(7);
        pdf.text(modLabel, PW - M - 11, 8.2, { align: 'center' });
      }

      // 페이지 제목
      pdf.setTextColor(107, 123, 158);
      pdf.setFontSize(8);
      const pageTitle = (step.pageTitle || '').substring(0, 80);
      pdf.text(pageTitle, M + 28, 8.2);

      // 스크린샷 이미지 로드
      const imgData = step.screenshotWithMarker;
      if (imgData) {
        try {
          // 좌측: 스크린샷 영역
          const imgX = M;
          const imgY = 18;
          const imgAreaW = PW * 0.68 - M;
          const imgAreaH = PH - 24;

          // 흰색 카드 배경
          pdf.setFillColor(255, 255, 255);
          pdf.roundedRect(imgX, imgY, imgAreaW, imgAreaH, 2, 2, 'F');

          // 이미지 (비율 유지)
          const imgPad = 2;
          pdf.addImage(imgData, 'JPEG',
            imgX + imgPad, imgY + imgPad,
            imgAreaW - imgPad * 2, imgAreaH - imgPad * 2,
            undefined, 'FAST');
        } catch (e) {
          console.error('PDF 이미지 추가 실패:', e);
        }
      }

      // 우측: 설명 패널
      const panelX = PW * 0.68 + 4;
      const panelY = 18;
      const panelW = PW - panelX - M;
      const panelH = PH - 24;

      // 패널 배경
      pdf.setFillColor(255, 255, 255);
      pdf.roundedRect(panelX, panelY, panelW, panelH, 2, 2, 'F');

      // 패널 헤더
      pdf.setFillColor(44, 62, 107);
      pdf.roundedRect(panelX, panelY, panelW, 10, 2, 2, 'F');
      pdf.setFillColor(44, 62, 107);
      pdf.rect(panelX, panelY + 6, panelW, 4, 'F');
      pdf.setTextColor(255, 255, 255);
      pdf.setFontSize(9);
      pdf.text('Description', panelX + panelW / 2, panelY + 6.5, { align: 'center' });

      // 마커별 설명
      const markers = step.markers || [];
      let textY = panelY + 14;
      pdf.setFontSize(8);

      if (markers.length > 0) {
        const maxRows = Math.min(markers.length, 12);
        const rowH = Math.min(14, (panelH - 16) / maxRows);

        for (let mi = 0; mi < maxRows; mi++) {
          const m = markers[mi];
          const ry = textY + mi * rowH;

          // 번호 원
          pdf.setFillColor(230, 50, 50);
          pdf.circle(panelX + 6, ry + 2, 3, 'F');
          pdf.setTextColor(255, 255, 255);
          pdf.setFontSize(7);
          pdf.text(String(mi + 1), panelX + 6, ry + 3, { align: 'center' });

          // 설명 텍스트
          pdf.setTextColor(26, 26, 46);
          pdf.setFontSize(8);
          const desc = (m.description || '').substring(0, 50);
          pdf.text(desc, panelX + 12, ry + 3);
        }
      } else {
        pdf.setTextColor(107, 123, 158);
        pdf.setFontSize(8);
        const desc = (step.description || '(No description)').substring(0, 100);
        pdf.text(desc, panelX + 4, textY + 3, { maxWidth: panelW - 8 });
      }

      loaded++;
      statusEl.textContent = `PDF 생성 중... ${loaded}/${steps.length}`;
    }

    // 다운로드
    pdf.save(`${title}.pdf`);
    statusEl.remove();
  };

  addStepPages().catch((err) => {
    statusEl.remove();
    console.error('PDF 생성 실패:', err);
    alert('PDF 생성에 실패했습니다: ' + err.message);
  });
}

// ─── PPT 내보내기 ───
// 남색 컬러 팔레트
const NAVY = {
  dark: '1B2A4A',      // 진한 남색 (배경, 강조)
  main: '2C3E6B',      // 메인 남색
  mid: '3D5A99',       // 중간 남색
  light: 'E8ECF4',     // 밝은 남색 (배경)
  accent: '4A90D9',    // 포인트 파란색
  white: 'FFFFFF',
  text: '1A1A2E',      // 본문 텍스트
  sub: '6B7B9E',       // 보조 텍스트
  border: 'C8D1E0',    // 테두리
};
const FONT = 'Malgun Gothic'; // 맑은 고딕 (깔끔, 한글 지원)

function exportToPPTX(title, steps) {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';
  pptx.author = 'DX-AutoManual';

  // === 표지 슬라이드 ===
  const titleSlide = pptx.addSlide();
  titleSlide.background = { color: NAVY.dark };

  // 상단 장식선
  titleSlide.addShape(pptx.shapes.RECTANGLE, {
    x: 0, y: 0, w: 10, h: 0.06,
    fill: { color: NAVY.accent }
  });

  // 제목
  titleSlide.addText(title, {
    x: 1, y: 1.6, w: 8, h: 1.4,
    fontSize: 38, fontFace: FONT,
    color: NAVY.white, align: 'center', bold: true
  });

  // 구분선
  titleSlide.addShape(pptx.shapes.RECTANGLE, {
    x: 3.5, y: 3.1, w: 3, h: 0.04,
    fill: { color: NAVY.accent }
  });

  // 메타 정보
  titleSlide.addText(
    `${new Date().toLocaleDateString('ko-KR')}  |  총 ${steps.length}단계`, {
    x: 1, y: 3.4, w: 8, h: 0.5,
    fontSize: 14, fontFace: FONT,
    color: NAVY.sub, align: 'center'
  });

  titleSlide.addText('DX-AutoManual', {
    x: 1, y: 4.8, w: 8, h: 0.4,
    fontSize: 10, fontFace: FONT,
    color: '4A5568', align: 'center'
  });

  // === 각 단계 슬라이드 ===
  // 레이아웃: 좌측 스크린샷 (비율 유지) + 우측 설명 패널
  for (const step of steps) {
    const slide = pptx.addSlide();
    slide.background = { color: NAVY.light };

    // ── 상단 헤더 바 ──
    slide.addShape(pptx.shapes.RECTANGLE, {
      x: 0, y: 0, w: 10, h: 0.55,
      fill: { color: NAVY.dark }
    });

    // Step 번호 배지
    slide.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
      x: 0.3, y: 0.1, w: 1.0, h: 0.35,
      fill: { color: NAVY.accent },
      rectRadius: 0.05
    });
    slide.addText(`Step ${step.stepNumber}`, {
      x: 0.3, y: 0.1, w: 1.0, h: 0.35,
      fontSize: 12, fontFace: FONT,
      color: NAVY.white, align: 'center', bold: true
    });

    // 페이지 제목
    slide.addText(step.pageTitle || '', {
      x: 1.5, y: 0.1, w: 7.0, h: 0.35,
      fontSize: 10, fontFace: FONT,
      color: NAVY.sub, align: 'left', valign: 'middle'
    });

    // 수정됨 배지 (PPT)
    if (step.modified) {
      const modLabel = step.changeType === 're-recorded' ? '재녹화됨' : '수정됨';
      slide.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
        x: 8.6, y: 0.1, w: 1.1, h: 0.35,
        fill: { color: '7C3AED' },
        rectRadius: 0.05
      });
      slide.addText(modLabel, {
        x: 8.6, y: 0.1, w: 1.1, h: 0.35,
        fontSize: 9, fontFace: FONT,
        color: NAVY.white, align: 'center', bold: true
      });
    }

    // ── 좌측: 스크린샷 영역 ──
    const imgX = 0.3;
    const imgY = 0.75;
    const imgW = 6.6;
    const imgH = 4.6;

    // 스크린샷 카드 배경
    slide.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
      x: imgX, y: imgY, w: imgW, h: imgH,
      fill: { color: NAVY.white },
      rectRadius: 0.08,
      shadow: { type: 'outer', blur: 4, offset: 1, color: '000000', opacity: 0.08 }
    });

    // 스크린샷 이미지 (contain → 비율 유지, 카드 안에서 센터링)
    const imgPad = 0.1;
    slide.addImage({
      data: step.screenshotWithMarker,
      x: imgX + imgPad, y: imgY + imgPad,
      w: imgW - imgPad * 2, h: imgH - imgPad * 2,
      sizing: { type: 'contain', w: imgW - imgPad * 2, h: imgH - imgPad * 2 }
    });

    // ── 우측: 설명 패널 ──
    const panelX = 7.1;
    const panelY = 0.75;
    const panelW = 2.7;
    const panelH = 4.6;

    // 설명 패널 배경
    slide.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
      x: panelX, y: panelY, w: panelW, h: panelH,
      fill: { color: NAVY.white },
      rectRadius: 0.08,
      shadow: { type: 'outer', blur: 4, offset: 1, color: '000000', opacity: 0.08 }
    });

    // 설명 헤더
    slide.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
      x: panelX, y: panelY, w: panelW, h: 0.45,
      fill: { color: NAVY.main },
      rectRadius: 0.08
    });
    // 하단 모서리 채우기 (헤더 아래 직각 처리)
    slide.addShape(pptx.shapes.RECTANGLE, {
      x: panelX, y: panelY + 0.3, w: panelW, h: 0.15,
      fill: { color: NAVY.main }
    });

    slide.addText('설명', {
      x: panelX, y: panelY, w: panelW, h: 0.45,
      fontSize: 11, fontFace: FONT,
      color: NAVY.white, align: 'center', bold: true, valign: 'middle'
    });

    // 마커별 설명 텍스트
    const markers = step.markers || [];
    let descTextY = panelY + 0.55;
    const descTextH = panelH - 0.55 - 0.15;

    if (markers.length > 0) {
      // 마커별 설명을 번호 리스트로 표시
      const rowH = Math.min(0.38, descTextH / markers.length);
      markers.forEach((m, mi) => {
        const y = descTextY + mi * rowH;
        // 번호 원
        slide.addShape(pptx.shapes.OVAL, {
          x: panelX + 0.15, y: y + 0.06,
          w: 0.22, h: 0.22,
          fill: { color: 'E63232' }
        });
        slide.addText(String(mi + 1), {
          x: panelX + 0.15, y: y + 0.06,
          w: 0.22, h: 0.22,
          fontSize: 8, fontFace: FONT,
          color: NAVY.white, align: 'center', valign: 'middle', bold: true
        });
        // 설명 텍스트
        slide.addText(m.description || '', {
          x: panelX + 0.45, y: y + 0.02,
          w: panelW - 0.6, h: rowH - 0.04,
          fontSize: 9, fontFace: FONT,
          color: NAVY.text, valign: 'middle',
          shrinkText: true, wrap: true
        });
      });
    } else {
      const desc = step.description || '(설명 없음)';
      slide.addText(desc, {
        x: panelX + 0.2, y: descTextY,
        w: panelW - 0.4, h: descTextH,
        fontSize: 11, fontFace: FONT,
        color: NAVY.text, valign: 'top',
        lineSpacingMultiple: 1.5,
        shrinkText: true, wrap: true
      });
    }
  }

  // === 마지막 슬라이드 ===
  const endSlide = pptx.addSlide();
  endSlide.background = { color: NAVY.dark };
  endSlide.addShape(pptx.shapes.RECTANGLE, {
    x: 0, y: 0, w: 10, h: 0.06,
    fill: { color: NAVY.accent }
  });
  endSlide.addText('End of Document', {
    x: 1, y: 2, w: 8, h: 1,
    fontSize: 28, fontFace: FONT,
    color: NAVY.white, align: 'center', bold: true
  });
  endSlide.addText(`${title}  |  총 ${steps.length}단계`, {
    x: 1, y: 3.2, w: 8, h: 0.5,
    fontSize: 13, fontFace: FONT,
    color: NAVY.sub, align: 'center'
  });

  // 파일 다운로드
  pptx.writeFile({ fileName: `${title}.pptx` }).then(() => {
    console.log('[DX-AutoManual] PPT 내보내기 완료');
  }).catch((err) => {
    console.error('[DX-AutoManual] PPT 내보내기 실패:', err);
    alert('PPT 내보내기에 실패했습니다: ' + err.message);
  });
}

// ─── GIF 내보내기 ───
function exportToGIF(title, steps) {
  if (typeof GIF === 'undefined') {
    alert('GIF 라이브러리를 불러오지 못했습니다.');
    return;
  }

  const WIDTH = 800;
  const statusEl = document.createElement('div');
  statusEl.style.cssText = 'position:fixed;top:0;left:0;right:0;padding:12px;background:#1b2a4a;color:#fff;text-align:center;font-size:14px;z-index:99999;font-family:inherit;';
  statusEl.textContent = 'GIF 생성 중... (0%)';
  document.body.appendChild(statusEl);

  const workerUrl = chrome.runtime.getURL('vendor/gif.worker.js');
  const gif = new GIF({
    workers: 2,
    quality: 10,
    width: WIDTH,
    height: Math.round(WIDTH * 0.6),
    workerScript: workerUrl
  });

  const gifH = Math.round(WIDTH * 0.6);
  let loaded = 0;

  // 각 단계의 이미지를 캔버스로 렌더링 후 프레임 추가
  const addFrames = async () => {
    for (const step of steps) {
      const frameCanvas = document.createElement('canvas');
      frameCanvas.width = WIDTH;
      frameCanvas.height = gifH;
      const fCtx = frameCanvas.getContext('2d');

      // 배경
      fCtx.fillStyle = '#e8ecf4';
      fCtx.fillRect(0, 0, WIDTH, gifH);

      // 상단 바
      fCtx.fillStyle = '#1b2a4a';
      fCtx.fillRect(0, 0, WIDTH, 36);
      fCtx.fillStyle = '#4a90d9';
      fCtx.font = 'bold 14px sans-serif';
      fCtx.textBaseline = 'middle';
      fCtx.fillText(`Step ${step.stepNumber}`, 12, 18);
      fCtx.fillStyle = '#6b7b9e';
      fCtx.font = '11px sans-serif';
      fCtx.fillText(step.pageTitle || '', 100, 18);

      // 스크린샷
      await new Promise((resolve) => {
        const img = new Image();
        img.onerror = () => resolve(); // 로드 실패 시 스킵
        img.onload = () => {
          // 비율 유지하여 중앙 배치
          const maxW = WIDTH - 20;
          const maxH = gifH - 80;
          const ratio = Math.min(maxW / img.width, maxH / img.height);
          const drawW = img.width * ratio;
          const drawH = img.height * ratio;
          const drawX = (WIDTH - drawW) / 2;
          const drawY = 42 + (maxH - drawH) / 2;

          fCtx.drawImage(img, drawX, drawY, drawW, drawH);

          // 하단 설명
          const desc = step.description || '';
          const shortDesc = desc.length > 60 ? desc.substring(0, 60) + '...' : desc;
          fCtx.fillStyle = 'rgba(27,42,74,0.85)';
          fCtx.fillRect(0, gifH - 32, WIDTH, 32);
          fCtx.fillStyle = '#ffffff';
          fCtx.font = '12px sans-serif';
          fCtx.textBaseline = 'middle';
          fCtx.fillText(shortDesc, 12, gifH - 16);

          resolve();
        };
        img.src = step.screenshotWithMarker;
      });

      gif.addFrame(frameCanvas, { delay: 2500, copy: true });
      loaded++;
      statusEl.textContent = `GIF 생성 중... 프레임 ${loaded}/${steps.length}`;
    }

    gif.on('progress', (p) => {
      statusEl.textContent = `GIF 인코딩 중... ${Math.round(p * 100)}%`;
    });

    gif.on('finished', (blob) => {
      statusEl.remove();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${title}.gif`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });

    gif.render();
  };

  addFrames();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
