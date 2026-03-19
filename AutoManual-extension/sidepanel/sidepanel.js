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
const modeHint = document.getElementById('modeHint');

let isRecording = false;

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
  modeHint.textContent = modeHints[mode];
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

function addStepCard(step) {
  emptyState.style.display = 'none';
  bottomBar.style.display = 'flex';

  const stepIndex = step.stepNumber - 1;
  const card = document.createElement('div');
  card.className = 'step-card';
  card.dataset.index = stepIndex;

  // ── 헤더 ──
  const header = document.createElement('div');
  header.className = 'step-card-header';

  const numSpan = document.createElement('span');
  numSpan.className = 'step-number';
  numSpan.textContent = `Step ${step.stepNumber}`;

  const metaSpan = document.createElement('span');
  metaSpan.className = 'step-meta';
  metaSpan.title = step.pageTitle || '';
  metaSpan.textContent = step.pageTitle || step.pageUrl || '';

  const actions = document.createElement('div');
  actions.className = 'step-actions';

  // 편집기 열기
  const editBtn = document.createElement('button');
  editBtn.textContent = '✏️';
  editBtn.title = '편집기 열기';
  editBtn.addEventListener('click', () => {
    const editorUrl = chrome.runtime.getURL('editor/editor.html') + '?step=' + stepIndex;
    chrome.tabs.create({ url: editorUrl });
  });
  actions.appendChild(editBtn);

  const upBtn = document.createElement('button');
  upBtn.textContent = '⬆️';
  upBtn.title = '위로 이동';
  upBtn.addEventListener('click', () => moveStep(stepIndex, stepIndex - 1));
  actions.appendChild(upBtn);

  const downBtn = document.createElement('button');
  downBtn.textContent = '⬇️';
  downBtn.title = '아래로 이동';
  downBtn.addEventListener('click', () => moveStep(stepIndex, stepIndex + 1));
  actions.appendChild(downBtn);

  const deleteBtn = document.createElement('button');
  deleteBtn.textContent = '🗑️';
  deleteBtn.title = '이 단계 삭제';
  deleteBtn.addEventListener('click', () => deleteStep(stepIndex));
  actions.appendChild(deleteBtn);

  header.appendChild(numSpan);
  header.appendChild(metaSpan);
  header.appendChild(actions);

  // ── 스크린샷 (클릭하면 풀스크린 보기) ──
  const imgWrap = document.createElement('div');
  imgWrap.className = 'step-screenshot-wrap';

  const img = document.createElement('img');
  img.className = 'step-screenshot';
  img.src = step.screenshotWithMarker;
  img.alt = `Step ${step.stepNumber}`;
  img.addEventListener('click', () => openImageFullscreen(step.screenshotWithMarker));

  const editHint = document.createElement('div');
  editHint.className = 'step-add-hint';
  editHint.textContent = '✏️ 편집은 연필 버튼 클릭';

  imgWrap.appendChild(img);
  imgWrap.appendChild(editHint);

  // ── 마커별 설명 목록 ──
  const markersDiv = document.createElement('div');
  markersDiv.className = 'step-markers-list';

  // 마커가 없거나 배열이 아니면 step 정보로 기본 마커 생성
  let markers = Array.isArray(step.markers) && step.markers.length > 0
    ? step.markers
    : [{
        number: 1,
        element: step.element || { tag: '', text: '' },
        description: step.description || step.element?.autoDescription || ''
      }];

  // 각 마커의 description이 비어있으면 step.description에서 추출 시도
  markers.forEach((m, i) => {
    if (!m.description && step.description) {
      // "1. 설명\n2. 설명" 형식에서 해당 번호의 설명 추출
      const lines = step.description.split('\n');
      const prefix = `${i + 1}. `;
      const matched = lines.find(l => l.startsWith(prefix));
      if (matched) {
        m.description = matched.substring(prefix.length);
      } else if (markers.length === 1) {
        m.description = step.description;
      }
    }
  });

  {
    markers.forEach((marker, mi) => {
      const row = document.createElement('div');
      row.className = 'marker-row';

      // 번호 배지
      const badge = document.createElement('span');
      badge.className = 'marker-badge';
      badge.textContent = marker.number || (mi + 1);

      // 요소 정보
      const elInfo = document.createElement('span');
      elInfo.className = 'marker-el-info';
      const mText = marker.element?.text ? `"${marker.element.text}"` : '';
      const mTag = (marker.element?.tag || '').toLowerCase();
      elInfo.textContent = mText || mTag || '';

      // 삭제 버튼
      const delBtn = document.createElement('button');
      delBtn.className = 'marker-del-btn';
      delBtn.textContent = '✕';
      delBtn.title = '이 마커 삭제';
      delBtn.addEventListener('click', () => {
        chrome.runtime.sendMessage({
          type: 'DELETE_MARKER',
          stepIndex: stepIndex,
          markerIndex: mi
        }, (response) => {
          if (response?.success) refreshStepListFromBg();
        });
      });

      // 헤더 행
      const rowHeader = document.createElement('div');
      rowHeader.className = 'marker-row-header';
      rowHeader.appendChild(badge);
      rowHeader.appendChild(elInfo);
      rowHeader.appendChild(delBtn);

      // 설명 입력
      const ta = document.createElement('textarea');
      ta.className = 'marker-textarea';
      ta.placeholder = `${mi + 1}번 마커 설명...`;
      ta.value = marker.description || '';
      ta.rows = 2;
      ta.addEventListener('change', (e) => {
        chrome.runtime.sendMessage({
          type: 'UPDATE_MARKER_DESC',
          stepIndex: stepIndex,
          markerIndex: mi,
          description: e.target.value
        });
      });

      row.appendChild(rowHeader);
      row.appendChild(ta);
      markersDiv.appendChild(row);
    });
  }

  // ── 카드 조립 ──
  card.appendChild(header);
  card.appendChild(imgWrap);
  card.appendChild(markersDiv);

  stepList.appendChild(card);
  stepList.scrollTop = stepList.scrollHeight;
}

// background에서 최신 데이터 가져와서 목록 새로고침
function refreshStepListFromBg() {
  chrome.runtime.sendMessage({ type: 'GET_STEPS' }, (response) => {
    if (response?.steps) refreshStepList(response.steps);
  });
}

function updateStepCount() {
  const count = stepList.querySelectorAll('.step-card').length;
  stepCount.textContent = `${count} 단계`;
}

// ─── 전체 목록 새로고침 ───
function refreshStepList(stepsData) {
  stepList.querySelectorAll('.step-card').forEach((card) => card.remove());
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
    if (response?.success) refreshStepList(response.steps);
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

// ─── 미리보기 ───
previewBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'GET_STEPS' }, (response) => {
    if (!response?.steps?.length) {
      alert('캡처된 단계가 없습니다.');
      return;
    }

    const title = document.getElementById('manualTitle').value || '매뉴얼';

    // viewer 페이지에서 background.js의 데이터를 직접 가져옴 (storage 미사용)
    const viewerUrl = chrome.runtime.getURL('viewer/viewer.html')
      + '?title=' + encodeURIComponent(title);
    chrome.tabs.create({ url: viewerUrl });
  });
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
    return `
  <div class="step">
    <div class="step-left">
      <div class="step-header">
        <span class="step-num">Step ${step.stepNumber}</span>
        <span class="step-url">${escapeHtml(step.pageTitle || '')}</span>
      </div>
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
      x: 1.5, y: 0.1, w: 8.2, h: 0.35,
      fontSize: 10, fontFace: FONT,
      color: NAVY.sub, align: 'left', valign: 'middle'
    });

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
