// ========================================
// viewer.js — 편집 가능한 미리보기 페이지
// 큰 화면에서 마커별 설명 편집 + 단계 관리
// ========================================

const params = new URLSearchParams(location.search);
const title = params.get('title') || '매뉴얼';

let allSteps = [];
let viewerReRecordIndex = null;

// ── 초기 로드 ──
loadAndRender();

// ── 재녹화 배너 (동적 생성) ──
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
      viewerReRecordIndex = null;
      banner.style.display = 'none';
    });
  });

  document.getElementById('viewerReRecordFinish').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'FINISH_RE_RECORD' }, (response) => {
      viewerReRecordIndex = null;
      banner.style.display = 'none';
      if (response?.success) loadAndRender();
      else alert(response?.error || '재녹화 완료 실패');
    });
  });
}

function startViewerReRecord(stepIndex, stepNumber) {
  createReRecordBanner();
  viewerReRecordIndex = stepIndex;
  const banner = document.getElementById('viewerReRecordBanner');
  const msg = document.getElementById('viewerReRecordMsg');
  const finishBtn = document.getElementById('viewerReRecordFinish');
  msg.textContent = `Step ${stepNumber} 재녹화 중 — 웹페이지를 클릭하세요 (0장 캡처됨)`;
  finishBtn.style.display = 'none';
  banner.style.display = 'flex';
  chrome.runtime.sendMessage({ type: 'START_RE_RECORD', stepIndex });
}

function loadAndRender() {
  chrome.runtime.sendMessage({ type: 'GET_STEPS' }, (response) => {
    if (chrome.runtime.lastError || !response?.steps?.length) {
      document.getElementById('stepContainer').innerHTML =
        '<p style="text-align:center; color:#6b7b9e; padding:60px;">미리볼 데이터가 없습니다.</p>';
      return;
    }

    allSteps = response.steps;

    document.getElementById('manualTitle').textContent = title;
    document.getElementById('manualMeta').textContent =
      `작성일: ${new Date().toLocaleDateString('ko-KR')} | 총 ${allSteps.length}단계`;
    document.title = `${title} — 미리보기`;

    renderSteps();
  });
}

function renderSteps() {
  const container = document.getElementById('stepContainer');
  container.innerHTML = '';

  allSteps.forEach((step, si) => {
    const div = document.createElement('div');
    div.className = 'step' + (step.modified ? ' step-modified' : '');

    // ── 좌측: 헤더 + 스크린샷 ──
    const left = document.createElement('div');
    left.className = 'step-left';

    // ── 상단 헤더 바 (Step 번호 + 제목 + 액션 버튼 한 줄) ──
    const header = document.createElement('div');
    header.className = 'step-header';

    const headerLeft = document.createElement('div');
    headerLeft.className = 'step-header-left';
    const num = document.createElement('span');
    num.className = 'step-num';
    num.textContent = `Step ${step.stepNumber}`;
    if (step.modified) {
      const modBadge = document.createElement('span');
      modBadge.className = 'step-modified-badge';
      modBadge.textContent = step.changeType === 're-recorded' ? '🔄 재녹화됨' : '✏️ 수정됨';
      num.appendChild(document.createTextNode(' '));
      num.appendChild(modBadge);
    }
    const url = document.createElement('span');
    url.className = 'step-url';
    url.textContent = step.pageTitle || '';
    headerLeft.appendChild(num);
    headerLeft.appendChild(url);

    const headerActions = document.createElement('div');
    headerActions.className = 'step-header-actions';

    const reRecBtn = document.createElement('button');
    reRecBtn.textContent = '🔄 재녹화';
    reRecBtn.addEventListener('click', () => startViewerReRecord(si, step.stepNumber));

    const editBtn = document.createElement('button');
    editBtn.textContent = '✏️ 편집기';
    editBtn.addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('editor/editor.html') + '?step=' + si });
    });

    const upBtn = document.createElement('button');
    upBtn.textContent = '↑';
    upBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'MOVE_STEP', from: si, to: si - 1 }, () => loadAndRender());
    });

    const downBtn = document.createElement('button');
    downBtn.textContent = '↓';
    downBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'MOVE_STEP', from: si, to: si + 1 }, () => loadAndRender());
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'del-btn';
    delBtn.textContent = '🗑️';
    delBtn.addEventListener('click', () => {
      if (!confirm(`Step ${step.stepNumber}을 삭제하시겠습니까?`)) return;
      chrome.runtime.sendMessage({ type: 'DELETE_STEP', index: si }, () => loadAndRender());
    });

    headerActions.appendChild(reRecBtn);
    headerActions.appendChild(editBtn);
    headerActions.appendChild(upBtn);
    headerActions.appendChild(downBtn);
    headerActions.appendChild(delBtn);

    header.appendChild(headerLeft);
    header.appendChild(headerActions);

    const img = document.createElement('img');
    img.src = step.screenshotWithMarker;
    img.alt = `Step ${step.stepNumber}`;
    img.addEventListener('click', () => openFullscreen(img.src));

    left.appendChild(header);

    // 변경 요약 바
    if (step.modified && step.changeSummary) {
      const changeBanner = document.createElement('div');
      changeBanner.className = 'step-change-banner';
      const typeLabel = step.changeType === 're-recorded' ? '🔄 재녹화' : '✏️ 편집';
      const timeStr = step.modifiedAt ? new Date(step.modifiedAt).toLocaleString('ko-KR') : '';
      changeBanner.textContent = `${typeLabel}: ${step.changeSummary} (${timeStr})`;
      left.appendChild(changeBanner);
    }

    left.appendChild(img);

    // ── 우측: 마커별 편집 가능 설명 ──
    const right = document.createElement('div');
    right.className = 'step-right';

    const rightHeader = document.createElement('div');
    rightHeader.className = 'step-right-header';
    const rightTitle = document.createElement('span');
    rightTitle.textContent = '설명';
    rightHeader.appendChild(rightTitle);

    right.appendChild(rightHeader);

    // 마커 목록
    let markers = Array.isArray(step.markers) && step.markers.length > 0
      ? step.markers
      : [{
          number: 1,
          element: step.element || { tag: '', text: '' },
          description: step.description || ''
        }];

    // description 동기화
    markers.forEach((m, i) => {
      if (!m.description && step.description) {
        const lines = step.description.split('\n');
        const prefix = `${i + 1}. `;
        const matched = lines.find(l => l.startsWith(prefix));
        if (matched) m.description = matched.substring(prefix.length);
        else if (markers.length === 1) m.description = step.description;
      }
    });

    // 마커 드래그 상태
    let dragMarkerFrom = null;

    markers.forEach((marker, mi) => {
      const row = document.createElement('div');
      row.className = 'step-marker-row';
      row.dataset.markerIndex = mi;
      row.draggable = true;

      // 드래그 이벤트
      row.addEventListener('dragstart', (e) => {
        dragMarkerFrom = mi;
        row.classList.add('marker-dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', mi);
      });
      row.addEventListener('dragend', () => {
        row.classList.remove('marker-dragging');
        right.querySelectorAll('.marker-dragover').forEach(r => r.classList.remove('marker-dragover'));
        dragMarkerFrom = null;
      });
      row.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (dragMarkerFrom !== null && dragMarkerFrom !== mi) {
          row.classList.add('marker-dragover');
        }
      });
      row.addEventListener('dragleave', () => {
        row.classList.remove('marker-dragover');
      });
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        row.classList.remove('marker-dragover');
        if (dragMarkerFrom !== null && dragMarkerFrom !== mi) {
          const order = markers.map((_, i) => i);
          const [moved] = order.splice(dragMarkerFrom, 1);
          order.splice(mi, 0, moved);
          chrome.runtime.sendMessage({
            type: 'REORDER_MARKERS',
            stepIndex: si,
            newOrder: order
          }, () => {
            loadAndRender();
            // 일시적 피드백: 이동된 위치 하이라이트
            setTimeout(() => {
              const stepEl = container.querySelectorAll('.step')[si];
              if (stepEl) {
                // 캡처 이미지 깜빡임
                const img = stepEl.querySelector('.step-left img');
                if (img) {
                  img.style.outline = '3px solid #007aff';
                  img.style.outlineOffset = '-3px';
                  img.style.transition = 'outline 0.3s';
                  setTimeout(() => { img.style.outline = 'none'; }, 1500);
                }
                // 이동된 설명 행 하이라이트
                const rows = stepEl.querySelectorAll('.step-marker-row');
                if (rows[mi]) {
                  rows[mi].classList.add('marker-just-moved');
                  setTimeout(() => rows[mi].classList.remove('marker-just-moved'), 1500);
                }
              }
            }, 100);
          });
        }
      });

      // 좌측: 번호 + 삭제 + 드래그 핸들
      const rowLeft = document.createElement('div');
      rowLeft.className = 'marker-row-left';

      const dragHandle = document.createElement('span');
      dragHandle.className = 'marker-drag-handle';
      dragHandle.textContent = '⠿';
      dragHandle.title = '드래그하여 순서 변경';
      rowLeft.appendChild(dragHandle);

      const badge = document.createElement('span');
      badge.className = 'step-marker-badge';
      badge.textContent = mi + 1;
      rowLeft.appendChild(badge);

      if (markers.length > 1) {
        const mDel = document.createElement('button');
        mDel.className = 'marker-del-small';
        mDel.textContent = '삭제';
        mDel.addEventListener('click', () => {
          chrome.runtime.sendMessage({
            type: 'DELETE_MARKER', stepIndex: si, markerIndex: mi
          }, () => loadAndRender());
        });
        rowLeft.appendChild(mDel);
      }

      // 우측: 설명 편집
      const content = document.createElement('div');
      content.className = 'marker-content';

      const ta = document.createElement('textarea');
      ta.className = 'marker-desc-edit';
      ta.value = marker.description || '';
      ta.placeholder = `${mi + 1}번 마커 설명...`;
      ta.rows = 2;
      ta.addEventListener('change', (e) => {
        chrome.runtime.sendMessage({
          type: 'UPDATE_MARKER_DESC',
          stepIndex: si,
          markerIndex: mi,
          description: e.target.value
        });
      });
      content.appendChild(ta);

      row.appendChild(rowLeft);
      row.appendChild(content);
      right.appendChild(row);
    });

    div.appendChild(left);
    div.appendChild(right);
    container.appendChild(div);
  });
}

// ── 풀스크린 ──
function openFullscreen(src) {
  const overlay = document.createElement('div');
  overlay.className = 'fullscreen-overlay';
  const img = document.createElement('img');
  img.src = src;
  overlay.appendChild(img);
  overlay.addEventListener('click', () => overlay.remove());
  document.body.appendChild(overlay);
}

// ── 전체 저장 ──
document.getElementById('saveAllBtn').addEventListener('click', () => {
  // 현재 화면의 모든 textarea 값을 background에 반영 (이미 change 이벤트로 반영됨)
  alert('모든 변경사항이 저장되었습니다.');
});

// ── 닫기 ──
document.getElementById('closeViewerBtn').addEventListener('click', () => {
  window.close();
});

// (HTML 내보내기는 사이드패널 Export에서 제공)

function exportToHTML(title, steps) {
  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Malgun Gothic',-apple-system,sans-serif;max-width:1100px;margin:0 auto;padding:40px 20px;background:#e8ecf4;color:#1a1a2e}
h1{font-size:28px;margin-bottom:8px;color:#1b2a4a}
.meta{color:#6b7b9e;font-size:13px;margin-bottom:32px}
.step{display:flex;background:#fff;border-radius:12px;margin-bottom:24px;overflow:hidden;box-shadow:0 2px 8px rgba(27,42,74,.08);border:1px solid #c8d1e0}
.step.modified{border:3px solid #7c3aed;box-shadow:0 4px 20px rgba(124,58,237,.2)}
.change-banner{padding:8px 18px;background:linear-gradient(90deg,#faf5ff,#ede9fe);border-bottom:2px solid #7c3aed;border-left:4px solid #7c3aed;font-size:12px;color:#6d28d9;font-weight:600}
.mod-badge{display:inline-block;font-size:10px;font-weight:700;color:#fff;background:#7c3aed;padding:2px 8px;border-radius:8px;margin-left:6px}
.step-left{flex:7;min-width:0}
.step-header{padding:12px 18px;background:#1b2a4a;display:flex;justify-content:space-between;align-items:center}
.step-num{font-weight:700;color:#fff;font-size:13px;background:#4a90d9;padding:3px 12px;border-radius:5px}
.step-url{font-size:11px;color:#6b7b9e}
.step-left img{width:100%;display:block}
.step-right{flex:3;min-width:200px;max-width:320px;background:#f4f6fa;border-left:1px solid #c8d1e0;display:flex;flex-direction:column}
.step-right-header{padding:12px 16px;background:#2c3e6b;font-size:12px;font-weight:700;color:#fff;text-align:center}
.marker-row{display:flex;align-items:flex-start;gap:10px;padding:10px 14px;border-bottom:1px solid #e8ecf4}
.marker-row:last-child{border-bottom:none}
.marker-badge{display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:22px;border-radius:50%;background:#e63232;color:#fff;font-size:11px;font-weight:700;flex-shrink:0}
.marker-text{font-size:13px;line-height:1.6;color:#1a1a2e}
.footer{text-align:center;color:#6b7b9e;font-size:12px;margin-top:40px;padding:24px}
@media(max-width:768px){.step{flex-direction:column}.step-right{max-width:none;border-left:none;border-top:1px solid #c8d1e0}}
</style>
</head>
<body>
<h1>${esc(title)}</h1>
<div class="meta">작성일: ${new Date().toLocaleDateString('ko-KR')} | 총 ${steps.length}단계</div>
${steps.map(step => {
  const markers = step.markers || [];
  let descHtml;
  if (markers.length > 0) {
    descHtml = markers.map((m,i) =>
      `<div class="marker-row"><span class="marker-badge">${i+1}</span><span class="marker-text">${esc(m.description||'')}</span></div>`
    ).join('');
  } else {
    descHtml = `<div style="padding:16px;font-size:13px">${esc(step.description||'')}</div>`;
  }
  const modClass = step.modified ? ' modified' : '';
  const modBadge = step.modified ? `<span class="mod-badge">${step.changeType==='re-recorded'?'재녹화됨':'수정됨'}</span>` : '';
  const changeBanner = step.modified && step.changeSummary
    ? `<div class="change-banner">${step.changeType==='re-recorded'?'🔄':'✏️'} ${esc(step.changeSummary)}${step.modifiedAt?' ('+new Date(step.modifiedAt).toLocaleString('ko-KR')+')':''}</div>`
    : '';
  return `<div class="step${modClass}">
  <div class="step-left">
    <div class="step-header">
      <span class="step-num">Step ${step.stepNumber}${modBadge}</span>
      <span class="step-url">${esc(step.pageTitle||'')}</span>
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
<div class="footer">AutoManual로 생성됨</div>
</body></html>`;

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

function esc(text) {
  const d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}

// ── 메시지 수신 ──
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'EDITOR_SAVED') {
    loadAndRender();
  }
  // 재녹화 진행
  if (message.type === 'RE_RECORD_PROGRESS') {
    const msg = document.getElementById('viewerReRecordMsg');
    const finishBtn = document.getElementById('viewerReRecordFinish');
    if (msg) msg.textContent = `Step ${message.stepIndex + 1} 재녹화 중 — ${message.capturedCount}장 캡처됨`;
    if (finishBtn) finishBtn.style.display = 'inline-block';
  }
  // 재녹화 완료
  if (message.type === 'RE_RECORD_DONE') {
    viewerReRecordIndex = null;
    const banner = document.getElementById('viewerReRecordBanner');
    if (banner) banner.style.display = 'none';
    loadAndRender();
  }
});
