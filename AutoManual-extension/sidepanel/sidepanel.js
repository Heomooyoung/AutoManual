// ========================================
// sidepanel.js — 사이드 패널 로직
// Chrome Extension CSP: 모든 이벤트를 addEventListener로 연결
// ========================================

const recordBtn = document.getElementById('recordBtn');
const recordBtnText = document.getElementById('recordBtnText');
const cancelRecordBtn = document.getElementById('cancelRecordBtn');
const completeRecordBtn = document.getElementById('completeRecordBtn');
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
let isPaused = false; // 일시정지 상태
let isCompleted = false; // 완료 상태 (녹화 종료됨)
let lastSavedFilename = null; // 마지막 저장 파일명 (덮어쓰기용)
let reRecordStepIndex = null; // 재녹화 중인 단계 인덱스
let selectMode = false;
let selectedIndices = new Set();

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

function sanitizeFilename(name) {
  return name.replace(/[\/\\:*?"<>|]/g, '_').trim() || 'untitled';
}

function blobToDataUrl(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

// 서비스워커 슬립 대응 — 재시도 sendMessage
// expectData: true이면 빈 응답도 재시도 (세부편집/저장/내보내기용)
function sendMsgRetry(msg, retries, expectData) {
  if (retries === undefined) retries = 5;
  if (expectData === undefined) expectData = true;
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (response) => {
      if (chrome.runtime.lastError || response === undefined) {
        // SW 아직 안 깨어남
        if (retries > 0) {
          setTimeout(() => sendMsgRetry(msg, retries - 1, expectData).then(resolve), 400);
        } else {
          resolve(null);
        }
      } else if (expectData && msg.type === 'GET_STEPS' && (!response.steps || response.steps.length === 0)) {
        // SW 깨어났지만 storage에서 아직 복구 안 됨
        if (retries > 0) {
          setTimeout(() => sendMsgRetry(msg, retries - 1, expectData).then(resolve), 400);
        } else {
          resolve(response);
        }
      } else {
        resolve(response);
      }
    });
  });
}

saveManualBtn.addEventListener('click', async () => {
  const title = document.getElementById('manualTitle').value || '제목 없음';
  const stepsRes = await sendMsgRetry({ type: 'GET_STEPS' });
  if (!stepsRes?.steps?.length) {
    alert('저장할 단계가 없습니다.');
    return;
  }

  const saveData = {
    title,
    savedAt: Date.now(),
    stepCount: stepsRes.steps.length,
    steps: stepsRes.steps
  };
  const json = JSON.stringify(saveData);
  const blob = new Blob([json], { type: 'application/json' });
  const dataUrl = await blobToDataUrl(blob);
  const filename = lastSavedFilename || `${sanitizeFilename(title)}.json`;

  chrome.downloads.download({
    url: dataUrl,
    filename: filename,
    conflictAction: 'overwrite',
    saveAs: false
  }, (downloadId) => {
    if (chrome.runtime.lastError) {
      alert('저장에 실패했습니다: ' + chrome.runtime.lastError.message);
    } else {
      lastSavedFilename = filename;
    }
  });

  // 내부 저장도 병행
  chrome.runtime.sendMessage({ type: 'SAVE_MANUAL', title });
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

// ─── 파일에서 불러오기 ───
document.getElementById('loadFileBtn').addEventListener('click', async () => {
  try {
    let fileData;
    if (typeof showOpenFilePicker === 'function') {
      const [handle] = await showOpenFilePicker({
        types: [{
          description: 'AutoManual 파일',
          accept: { 'application/json': ['.json'] }
        }]
      });
      const file = await handle.getFile();
      fileData = await file.text();
    } else {
      // 폴백: input[type=file]
      fileData = await new Promise((resolve, reject) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.addEventListener('change', async () => {
          if (input.files[0]) {
            resolve(await input.files[0].text());
          } else {
            reject(new Error('취소'));
          }
        });
        input.click();
      });
    }

    const data = JSON.parse(fileData);
    if (!data.steps?.length) {
      alert('유효한 매뉴얼 파일이 아닙니다.');
      return;
    }

    if (!confirm('현재 작업을 대체하고 파일에서 불러오시겠습니까?')) return;

    // background에 steps 덮어쓰기
    chrome.runtime.sendMessage({ type: 'LOAD_FILE_STEPS', steps: data.steps }, (response) => {
      if (response?.success) {
        document.getElementById('manualTitle').value = data.title || '';
        manualListPanel.style.display = 'none';
        refreshStepList(data.steps);
      }
    });
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.error('파일 불러오기 실패:', err);
    }
  }
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

// ─── 캡처 버튼 ───
const captureBtn = document.getElementById('captureBtn');

// ─── 초기화 ───
sendMsgRetry({ type: 'GET_STATUS' }, 5, false).then((response) => {
  if (response) {
    isRecording = response.isRecording;
    // 녹화 중이 아니면서 스텝이 있으면 → 완료 상태로 복구 (편집 가능)
    if (!isRecording && response.stepCount > 0) {
      isCompleted = true;
      isPaused = false;
    }
    // 캡처 모드 UI 동기화
    if (response.captureMode) {
      modePerClick.classList.toggle('active', response.captureMode === 'per-click');
      modePerPage.classList.toggle('active', response.captureMode === 'per-page');
    }
    updateRecordButton();
    if (response.stepCount > 0) {
      loadSteps();
    }
  }
});

captureBtn.addEventListener('click', () => {
  if (!isRecording) return;
  captureBtn.disabled = true;
  chrome.runtime.sendMessage({ type: 'MANUAL_CAPTURE' }, (response) => {
    captureBtn.disabled = false;
    if (!response?.captured) {
      alert(response?.error || '캡처에 실패했습니다.');
    }
  });
});

// ─── 선택 모드 ───
const selectBar = document.getElementById('selectBar');
const selectToggleBtn = document.getElementById('selectToggleBtn');
const selectAllBtn = document.getElementById('selectAllBtn');
const selectCount = document.getElementById('selectCount');
const deleteSelectedBtn = document.getElementById('deleteSelectedBtn');

selectToggleBtn.addEventListener('click', () => {
  selectMode = !selectMode;
  selectedIndices.clear();
  selectToggleBtn.classList.toggle('active', selectMode);
  stepList.classList.toggle('select-mode', selectMode);
  updateSelectUI();
});

selectAllBtn.addEventListener('click', () => {
  const cards = stepList.querySelectorAll('.step-thumb-card');
  if (selectedIndices.size === cards.length) {
    selectedIndices.clear();
  } else {
    cards.forEach(c => selectedIndices.add(Number(c.dataset.index)));
  }
  updateSelectVisuals();
  updateSelectUI();
});

deleteSelectedBtn.addEventListener('click', () => {
  if (selectedIndices.size === 0) return;
  if (!confirm(`선택된 ${selectedIndices.size}개 단계를 삭제하시겠습니까?`)) return;
  chrome.runtime.sendMessage({
    type: 'DELETE_STEPS_MULTI',
    indices: Array.from(selectedIndices)
  }, (response) => {
    if (response?.success) {
      selectedIndices.clear();
      selectMode = false;
      selectToggleBtn.classList.remove('active');
      stepList.classList.remove('select-mode');
      updateSelectUI();
      refreshStepList(response.steps);
    }
  });
});

function updateSelectUI() {
  const show = selectMode;
  selectAllBtn.style.display = show ? 'inline-block' : 'none';
  selectCount.style.display = show ? 'inline' : 'none';
  deleteSelectedBtn.style.display = show ? 'inline-block' : 'none';
  selectCount.textContent = `${selectedIndices.size}개 선택`;

  const cards = stepList.querySelectorAll('.step-thumb-card');
  if (selectedIndices.size === cards.length && cards.length > 0) {
    selectAllBtn.textContent = '전체해제';
  } else {
    selectAllBtn.textContent = '전체선택';
  }

  updateSelectVisuals();
}

function updateSelectVisuals() {
  stepList.querySelectorAll('.step-thumb-card').forEach(card => {
    const idx = Number(card.dataset.index);
    card.classList.toggle('selected', selectedIndices.has(idx));
    const cb = card.querySelector('.step-thumb-checkbox');
    if (cb) cb.textContent = selectedIndices.has(idx) ? '✓' : '';
  });
}

// ─── 녹화 시작/일시정지/재개 ───
recordBtn.addEventListener('click', () => {
  if (!isRecording && !isPaused) {
    // 녹화 시작 (완료/초기 상태)
    const titleVal = document.getElementById('manualTitle').value.trim();
    if (!titleVal) {
      alert('매뉴얼 제목을 입력해주세요.');
      document.getElementById('manualTitle').focus();
      return;
    }
    // 완료 상태에서 다시 시작 → 기존 데이터 삭제 경고
    if (isCompleted) {
      if (!confirm('저장하지 않은 캡처는 삭제됩니다.\n새로 녹화를 시작하시겠습니까?')) return;
      chrome.runtime.sendMessage({ type: 'NEW_RECORDING' }, () => {
        clearStepList();
        isCompleted = false;
        chrome.runtime.sendMessage({ type: 'START_RECORDING' }, (response) => {
          if (response?.success) {
            isRecording = true;
            isPaused = false;
            lastSavedFilename = null;
            updateRecordButton();
          }
        });
      });
      return;
    }
    // 최초 녹화 시작
    chrome.runtime.sendMessage({ type: 'START_RECORDING' }, (response) => {
      if (response?.success) {
        isRecording = true;
        isPaused = false;
        isCompleted = false;
        updateRecordButton();
      }
    });
  } else if (isRecording && !isPaused) {
    // 녹화 중 → 일시정지
    chrome.runtime.sendMessage({ type: 'STOP_RECORDING' }, (response) => {
      if (response?.success) {
        isRecording = false;
        isPaused = true;
        updateRecordButton();
      }
    });
  } else if (isPaused) {
    // 일시정지 → 재개
    chrome.runtime.sendMessage({ type: 'START_RECORDING' }, (response) => {
      if (response?.success) {
        isRecording = true;
        isPaused = false;
        updateRecordButton();
        if (response.steps?.length > 0) {
          refreshStepList(response.steps);
        }
      }
    });
  }
});

// ─── 취소 버튼 ───
cancelRecordBtn.addEventListener('click', () => {
  if (!confirm('취소하면 모든 캡처가 사라집니다.\n정말 취소하시겠습니까?')) return;
  chrome.runtime.sendMessage({ type: 'NEW_RECORDING' }, (response) => {
    if (response?.success) {
      isRecording = false;
      isPaused = false;
      isCompleted = false;
      updateRecordButton();
      clearStepList();
      document.getElementById('manualTitle').value = '';
      document.getElementById('manualTitle').focus();
    }
  });
});

// ─── 완료 버튼 (녹화 종료 + 오버레이 안내) ───
completeRecordBtn.addEventListener('click', async () => {
  if (isRecording) {
    await new Promise(r => chrome.runtime.sendMessage({ type: 'STOP_RECORDING' }, r));
  }
  isRecording = false;
  isPaused = false;
  isCompleted = true;
  updateRecordButton();
  showCompleteOverlay();
});

function showCompleteOverlay() {
  const overlay = document.createElement('div');
  overlay.className = 'complete-overlay';
  overlay.innerHTML = `
    <div class="complete-overlay-box">
      <div class="complete-overlay-icon">✔</div>
      <div class="complete-overlay-title">녹화 완료</div>
      <div class="complete-overlay-msg">💾 저장 버튼을 눌러 저장하시기 바랍니다.</div>
      <button class="complete-overlay-close">확인</button>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('.complete-overlay-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
}

// ─── 신규 녹화 버튼 ───
const newManualBtn = document.getElementById('newManualBtn');
newManualBtn.addEventListener('click', () => {
  if (isRecording) {
    alert('녹화 중에는 신규를 시작할 수 없습니다. 먼저 일시정지하세요.');
    return;
  }
  const hasSteps = stepList.querySelectorAll('.step-thumb-card').length > 0;
  if (hasSteps) {
    if (!confirm('저장하지 않으면 현재 작업 내용이 모두 삭제됩니다.\n신규로 시작하시겠습니까?')) return;
  }
  chrome.runtime.sendMessage({ type: 'NEW_RECORDING' }, (response) => {
    if (response?.success) {
      isRecording = false;
      isPaused = false;
      isCompleted = false;
      lastSavedFilename = null;
      updateRecordButton();
      clearStepList();
      document.getElementById('manualTitle').value = '';
      document.getElementById('manualTitle').focus();
    }
  });
});

function updateRecordButton() {
  const cancelBtn = cancelRecordBtn;
  const completeBtn = completeRecordBtn;
  const dot = recordBtn.querySelector('.record-dot');

  if (isRecording) {
    // 녹화 중 → 일시정지 버튼으로 표시
    recordBtn.classList.add('recording');
    recordBtn.classList.remove('paused');
    recordBtnText.textContent = '정지';
    if (dot) { dot.textContent = '⏸'; dot.classList.add('pause-icon'); }
    captureBtn.disabled = false;
    captureBtn.style.display = '';
    cancelBtn.style.display = '';
    completeBtn.style.display = '';
    // 녹화 중 편집 잠금
    setEditingLocked(true);
  } else if (isPaused) {
    // 일시정지 → 재개 버튼으로 표시
    recordBtn.classList.remove('recording');
    recordBtn.classList.add('paused');
    recordBtnText.textContent = '재개';
    if (dot) { dot.textContent = '▶'; dot.classList.remove('pause-icon'); dot.classList.add('play-icon'); }
    captureBtn.disabled = true;
    captureBtn.style.display = 'none';
    cancelBtn.style.display = '';
    completeBtn.style.display = '';
    // 정지 시 편집 잠금 해제
    setEditingLocked(false);
  } else {
    // 초기 상태 → 녹화 시작
    recordBtn.classList.remove('recording', 'paused');
    recordBtnText.textContent = '녹화 시작';
    if (dot) { dot.textContent = ''; dot.classList.remove('pause-icon', 'play-icon'); }
    captureBtn.disabled = true;
    captureBtn.style.display = 'none';
    cancelBtn.style.display = 'none';
    completeBtn.style.display = 'none';
    // 완료 시 편집 잠금 해제
    setEditingLocked(false);
  }
}

function setEditingLocked(locked) {
  // 하단 바 전체 (세부편집 + Export)
  bottomBar.style.pointerEvents = locked ? 'none' : '';
  bottomBar.style.opacity = locked ? '0.4' : '';
  // 썸네일 액션 버튼 + 드래그
  stepList.classList.toggle('editing-locked', locked);
}

// ─── 새 단계 / 업데이트 수신 ───
// 글로벌 단축키로 토글된 경우 UI 동기화
chrome.runtime.onMessage.addListener((message) => {
  // 글로벌 단축키 녹화 토글
  if (message.type === 'RECORDING_TOGGLED') {
    isRecording = message.isRecording;
    if (isRecording) {
      isPaused = false;
    } else if (!isCompleted) {
      isPaused = true;
    }
    updateRecordButton();
  }
  if (message.type === 'NEW_STEP') {
    addStepCard(message.step);
    updateStepCount();
  }
  if (message.type === 'UPDATE_STEP') {
    // 화면당 1장 모드: 전체 목록을 새로고침하여 마커 목록도 갱신
    refreshStepListFromBg();
  }
  // 편집기에서 저장 완료 → 사이드 패널 새로고침 + 잠금 해제
  if (message.type === 'EDITOR_SAVED') {
    refreshStepListFromBg();
    if (!isRecording && !previewTabId) setEditingLocked(false);
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
  selectBar.style.display = 'none';
  selectMode = false;
  selectedIndices.clear();
  selectToggleBtn.classList.remove('active');
  stepList.classList.remove('select-mode');
}

function loadSteps() {
  sendMsgRetry({ type: 'GET_STEPS' }).then((response) => {
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
    if (isRecording) { e.preventDefault(); return; }
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

  // ── 선택 체크박스 ──
  const checkbox = document.createElement('div');
  checkbox.className = 'step-thumb-checkbox';
  card.appendChild(checkbox);

  // 선택 모드 클릭 처리
  card.addEventListener('click', (e) => {
    if (!selectMode) return;
    e.stopPropagation();
    if (selectedIndices.has(stepIndex)) {
      selectedIndices.delete(stepIndex);
    } else {
      selectedIndices.add(stepIndex);
    }
    updateSelectUI();
  });

  // ── 썸네일 이미지 ──
  const img = document.createElement('img');
  img.className = 'step-thumb-img';
  img.src = step.screenshotWithMarker;
  img.alt = `Step ${step.stepNumber}`;
  img.draggable = false; // 이미지 자체 드래그 방지
  img.addEventListener('click', () => { if (!selectMode) openImageFullscreen(step.screenshotWithMarker); });

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
  sendMsgRetry({ type: 'GET_STEPS' }).then((response) => {
    if (response?.steps) refreshStepList(response.steps);
  });
}

function updateStepCount() {
  const count = stepList.querySelectorAll('.step-thumb-card').length;
  stepCount.textContent = `${count} 단계`;
  selectBar.style.display = count > 0 ? 'flex' : 'none';
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
  // 선택 모드 유지 시 비주얼 동기화
  if (selectMode) {
    stepList.classList.add('select-mode');
    updateSelectVisuals();
  }
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
  sendMsgRetry({ type: 'MOVE_STEP', from, to }, 3, false).then((response) => {
    if (response?.success) {
      refreshStepList(response.steps);
      // 이동된 카드 하이라이트
      setTimeout(() => {
        const cards = stepList.querySelectorAll('.step-thumb-card');
        if (cards[to]) {
          cards[to].classList.add('step-thumb-moved');
          setTimeout(() => cards[to].classList.remove('step-thumb-moved'), 1500);
        }
      }, 50);
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

previewBtn.addEventListener('click', async () => {
  const response = await sendMsgRetry({ type: 'GET_STEPS' });
  if (!response?.steps?.length) {
    alert('캡처된 단계가 없습니다.');
    return;
  }

  const title = document.getElementById('manualTitle').value || '매뉴얼';
  const viewerUrl = chrome.runtime.getURL('viewer/viewer.html')
    + '?title=' + encodeURIComponent(title);

  if (previewTabId !== null) {
    chrome.tabs.get(previewTabId, (tab) => {
      if (chrome.runtime.lastError || !tab) {
        previewTabId = null;
        openPreviewTab(viewerUrl);
      } else {
        chrome.tabs.update(previewTabId, { url: viewerUrl, active: true });
        setEditingLocked(true);
      }
    });
  } else {
    openPreviewTab(viewerUrl);
  }
});

function openPreviewTab(url) {
  chrome.tabs.create({ url }, (tab) => {
    previewTabId = tab.id;
    setEditingLocked(true);
  });
}

// 미리보기 탭이 닫히면 잠금 해제
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === previewTabId) {
    previewTabId = null;
    if (!isRecording) setEditingLocked(false);
  }
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
  sendMsgRetry({ type: 'GET_STEPS' }).then((response) => {
    if (!response?.steps?.length) {
      alert('캡처된 단계가 없습니다.');
      return;
    }

    const title = document.getElementById('manualTitle').value || '매뉴얼';
    const steps = response.steps;

    if (format === 'html') {
      exportToHTML(title, steps);
    } else if (format === 'pptx') {
      exportToPPTX(title, steps);
    } else {
      alert(`${format.toUpperCase()} 내보내기는 다음 버전에서 지원됩니다.`);
    }
  });
}

// ─── HTML 내보내기 (좌측 캡처 + 우측 설명) ───
function exportToHTML(title, steps) {
  const dateStr = new Date().toLocaleDateString('ko-KR');
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
      background: #E8ECF4; color: #1A1A2E;
    }

    /* ── Cover Page ── */
    .cover {
      background: #1B2A4A;
      min-height: 100vh;
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      text-align: center;
      padding: 40px 20px;
      position: relative;
    }
    .cover-accent-line {
      width: 100%; height: 5px;
      background: #4A90D9;
      position: absolute; top: 0; left: 0;
    }
    .cover-title {
      font-size: 42px; font-weight: 700;
      color: #FFFFFF;
      margin-bottom: 24px;
      max-width: 800px;
      line-height: 1.3;
    }
    .cover-divider {
      width: 200px; height: 3px;
      background: #4A90D9;
      margin: 0 auto 24px;
    }
    .cover-meta {
      font-size: 16px; color: #6B7B9E;
      margin-bottom: 60px;
    }
    .cover-brand {
      font-size: 12px; color: #4A5568;
    }

    /* ── Steps Container ── */
    .steps-container {
      max-width: 1100px;
      margin: 0 auto;
      padding: 40px 20px;
    }

    /* ── Step Card ── */
    .step {
      background: #FFFFFF;
      border-radius: 10px;
      margin-bottom: 28px;
      overflow: hidden;
      box-shadow: 0 2px 10px rgba(27,42,74,0.10);
      border: 1px solid #C8D1E0;
    }
    .step-top-bar {
      display: flex;
      background: #1B2A4A;
    }
    .step-body {
      display: flex;
      align-items: stretch;
    }
    .step.modified {
      border: 3px solid #7C3AED;
      box-shadow: 0 4px 20px rgba(124,58,237,0.2);
    }

    /* ── Change Banner (modified steps) ── */
    .change-banner {
      padding: 8px 18px;
      background: linear-gradient(90deg, #faf5ff, #ede9fe);
      border-bottom: 2px solid #7C3AED;
      border-left: 4px solid #7C3AED;
      font-size: 12px; color: #6D28D9; font-weight: 600;
    }

    /* ── Left: Screenshot ── */
    .step-left { flex: 7; min-width: 0; display: flex; flex-direction: column; }
    .step-header {
      flex: 1;
      padding: 12px 18px;
      display: flex;
      align-items: center;
      gap: 14px;
    }
    .step-header-desc {
      width: 320px; min-width: 200px;
      padding: 12px 16px;
      border-left: 1px solid rgba(255,255,255,0.1);
      font-size: 12px; font-weight: 700;
      color: #FFFFFF;
      text-align: center;
      letter-spacing: 1px;
      display: flex; align-items: center; justify-content: center;
    }
    .step-badge {
      display: inline-block;
      font-weight: 700; color: #FFFFFF; font-size: 13px;
      background: #4A90D9;
      padding: 4px 14px;
      border-radius: 6px;
      white-space: nowrap;
    }
    .mod-badge {
      display: inline-block; font-size: 10px; font-weight: 700; color: #FFFFFF;
      background: #7C3AED; padding: 3px 10px; border-radius: 8px; margin-left: 6px;
    }
    .step-page-title {
      font-size: 12px; color: #6B7B9E;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .step-img-wrap {
      flex: 1;
      background: #FFFFFF;
      padding: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .step-img-card {
      width: 100%;
      border-radius: 6px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
      overflow: hidden;
    }
    .step-img-card img {
      width: 100%; display: block;
    }

    /* ── Right: Description Panel ── */
    .step-right {
      flex: 3; min-width: 200px; max-width: 320px;
      background: #F4F6FA;
      border-left: 1px solid #C8D1E0;
      display: flex; flex-direction: column;
    }
    .step-right-header {
      display: none;
    }
    .step-desc {
      padding: 16px; font-size: 13px;
      line-height: 1.7; flex: 1;
      white-space: pre-wrap; color: #1A1A2E;
    }

    /* ── Marker Rows ── */
    .marker-list { flex: 1; background: #F4F6FA; }
    .marker-row {
      display: flex; align-items: flex-start; gap: 10px;
      padding: 10px 14px;
      border-bottom: 1px solid #E8ECF4;
    }
    .marker-row:last-child { border-bottom: none; }
    .marker-row.odd { background: #F2F2F7; }
    .marker-badge {
      display: inline-flex; align-items: center; justify-content: center;
      min-width: 22px; height: 22px;
      border-radius: 50%;
      background: #E63232; color: #FFFFFF;
      font-size: 11px; font-weight: 700;
      flex-shrink: 0;
    }
    .marker-text {
      font-size: 13px; line-height: 1.6; color: #1A1A2E;
    }

    /* ── Footer ── */
    .footer {
      text-align: center; color: #6B7B9E;
      font-size: 12px; margin-top: 40px;
      padding: 24px 20px;
    }

    /* ── Responsive: mobile stacking ── */
    @media (max-width: 768px) {
      .cover-title { font-size: 28px; }
      .step-top-bar { flex-direction: column; }
      .step-header-desc { width: auto; border-left: none; border-top: 1px solid rgba(255,255,255,0.1); }
      .step-body { flex-direction: column; }
      .step-right {
        max-width: none;
        border-left: none;
        border-top: 1px solid #C8D1E0;
      }
    }
  </style>
</head>
<body>

  <!-- Cover Page -->
  <div class="cover">
    <div class="cover-accent-line"></div>
    <div class="cover-title">${escapeHtml(title)}</div>
    <div class="cover-divider"></div>
    <div class="cover-meta">${dateStr}  |  총 ${steps.length}단계</div>
    <div class="cover-brand">DX-AutoManual</div>
  </div>

  <!-- Steps -->
  <div class="steps-container">
  ${steps.map(step => {
    const markers = step.markers || [];
    let descHtml;
    if (markers.length > 0) {
      descHtml = '<div class="marker-list">' + markers.map((m, i) => `
        <div class="marker-row${i % 2 === 1 ? ' odd' : ''}">
          <span class="marker-badge">${i + 1}</span>
          <span class="marker-text">${escapeHtml(m.description || '(설명 없음)')}</span>
        </div>`).join('') + '</div>';
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
      <div class="step-top-bar">
        <div class="step-header">
          <span class="step-badge">Step ${step.stepNumber}${modBadge}</span>
          <span class="step-page-title">${escapeHtml(step.pageTitle || '')}</span>
        </div>
        <div class="step-header-desc">설명</div>
      </div>
      ${changeBanner}
      <div class="step-body">
        <div class="step-left">
          <div class="step-img-wrap">
            <div class="step-img-card">
              <img src="${step.screenshotWithMarker}" alt="Step ${step.stepNumber}">
            </div>
          </div>
        </div>
        <div class="step-right">
          ${descHtml}
        </div>
      </div>
    </div>`;
  }).join('\n')}
  </div>

  <div class="footer">DX-AutoManual로 생성됨</div>
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

// 라운드 사각형 헬퍼 (canvas용)
function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
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

  // === 슬라이드 생성 헬퍼 (텍스트 높이 기준 자동 분할) ===
  // 설명 한 줄당 약 0.12인치, 패널 사용 가능 높이 약 3.9인치
  const LINE_HEIGHT = 0.12; // 인치 (7pt 폰트 기준)
  const CHARS_PER_LINE = 18; // 패널 폭 기준 한 줄 글자 수 (한글)
  const PANEL_USABLE_H = 3.9; // 패널 설명 영역 높이 (인치)
  const MARKER_PADDING = 0.12; // 마커 간 여백

  // 마커 설명의 예상 높이 계산
  function estimateMarkerHeight(desc) {
    if (!desc) return LINE_HEIGHT + MARKER_PADDING;
    const lines = Math.ceil(desc.length / CHARS_PER_LINE);
    return Math.max(1, lines) * LINE_HEIGHT + MARKER_PADDING;
  }

  // 마커를 높이 기준으로 페이지 분할
  function splitMarkersByHeight(markers) {
    const pages = [];
    let currentPage = [];
    let currentH = 0;

    for (let mi = 0; mi < markers.length; mi++) {
      const desc = markers[mi].description || '';
      const h = estimateMarkerHeight(desc);

      if (currentPage.length > 0 && currentH + h > PANEL_USABLE_H) {
        pages.push(currentPage);
        currentPage = [];
        currentH = 0;
      }
      currentPage.push({ number: mi + 1, desc, estH: h });
      currentH += h;
    }
    if (currentPage.length > 0) pages.push(currentPage);
    return pages;
  }

  function addStepSlide(pptx, step, markersSlice, pageLabel) {
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
    slide.addText(`Step ${step.stepNumber}${pageLabel}`, {
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

    // 수정됨 배지
    if (step.modified) {
      const modLabel = step.changeType === 're-recorded' ? '재녹화됨' : '수정됨';
      slide.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
        x: 8.6, y: 0.1, w: 1.1, h: 0.35,
        fill: { color: '7C3AED' },
        rectRadius: 0.05
      });
      slide.addText(modLabel, {
        x: 8.6, y: 0.1, w: 1.1, h: 0.35,
        fontSize: 7, fontFace: FONT,
        color: NAVY.white, align: 'center', bold: true
      });
    }

    // ── 좌측: 스크린샷 ──
    const imgX = 0.3, imgY = 0.75, imgW = 6.6, imgH = 4.6;
    slide.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
      x: imgX, y: imgY, w: imgW, h: imgH,
      fill: { color: NAVY.white },
      rectRadius: 0.08,
      shadow: { type: 'outer', blur: 4, offset: 1, color: '000000', opacity: 0.08 }
    });
    const imgPad = 0.1;
    slide.addImage({
      data: step.screenshotWithMarker,
      x: imgX + imgPad, y: imgY + imgPad,
      w: imgW - imgPad * 2, h: imgH - imgPad * 2,
      sizing: { type: 'contain', w: imgW - imgPad * 2, h: imgH - imgPad * 2 }
    });

    // ── 우측: 설명 패널 ──
    const panelX = 7.1, panelY = 0.75, panelW = 2.7, panelH = 4.6;
    slide.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
      x: panelX, y: panelY, w: panelW, h: panelH,
      fill: { color: NAVY.white },
      rectRadius: 0.08,
      shadow: { type: 'outer', blur: 4, offset: 1, color: '000000', opacity: 0.08 }
    });

    // 설명 헤더
    slide.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
      x: panelX, y: panelY, w: panelW, h: 0.45,
      fill: { color: NAVY.main }, rectRadius: 0.08
    });
    slide.addShape(pptx.shapes.RECTANGLE, {
      x: panelX, y: panelY + 0.3, w: panelW, h: 0.15,
      fill: { color: NAVY.main }
    });
    slide.addText('설명', {
      x: panelX, y: panelY, w: panelW, h: 0.45,
      fontSize: 7, fontFace: FONT,
      color: NAVY.white, align: 'center', bold: true, valign: 'middle'
    });

    // 마커별 설명 (카드 스타일 + 자동 높이)
    let curY = panelY + 0.55;

    if (markersSlice.length > 0) {
      const isOdd = (i) => i % 2 === 1;
      markersSlice.forEach((item, di) => {
        const numStr = String(item.number);
        const badgeW = numStr.length >= 2 ? 0.32 : 0.22;
        const badgeH = 0.22;
        const descLines = Math.max(1, Math.ceil((item.desc || '').length / CHARS_PER_LINE));
        const rowH = descLines * LINE_HEIGHT + MARKER_PADDING;

        // 홀수행 배경색 (카드 구분)
        if (isOdd(di)) {
          slide.addShape(pptx.shapes.RECTANGLE, {
            x: panelX + 0.05, y: curY - 0.02,
            w: panelW - 0.1, h: rowH,
            fill: { color: 'F2F2F7' }
          });
        }

        // 번호 배지
        slide.addShape(pptx.shapes.OVAL, {
          x: panelX + 0.12, y: curY + 0.02,
          w: badgeW, h: badgeH,
          fill: { color: 'E63232' }
        });
        slide.addText(numStr, {
          x: panelX + 0.12, y: curY + 0.02,
          w: badgeW, h: badgeH,
          fontSize: 7, fontFace: FONT,
          color: NAVY.white, align: 'center', valign: 'middle', bold: true
        });

        // 설명 텍스트
        const textX = panelX + 0.12 + badgeW + 0.06;
        slide.addText(item.desc || '', {
          x: textX, y: curY,
          w: panelW - (textX - panelX) - 0.1, h: rowH - 0.04,
          fontSize: 7, fontFace: FONT,
          color: NAVY.text, valign: 'top',
          wrap: true, lineSpacingMultiple: 1.3
        });

        curY += rowH;
      });
    } else {
      slide.addText(step.description || '(설명 없음)', {
        x: panelX + 0.2, y: curY,
        w: panelW - 0.4, h: panelH - 0.7,
        fontSize: 7, fontFace: FONT,
        color: NAVY.text, valign: 'top',
        lineSpacingMultiple: 1.5,
        shrinkText: true, wrap: true
      });
    }
  }

  // === 각 단계 슬라이드 (텍스트 높이 기준 자동 분할) ===
  for (const step of steps) {
    const markers = step.markers || [];
    if (markers.length === 0) {
      addStepSlide(pptx, step, [], '');
    } else {
      const pages = splitMarkersByHeight(markers);
      for (let pi = 0; pi < pages.length; pi++) {
        const pageLabel = pages.length > 1 ? ` (${pi + 1}/${pages.length})` : '';
        addStepSlide(pptx, step, pages[pi], pageLabel);
      }
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

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
