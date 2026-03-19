// ========================================
// viewer.js — 편집 가능한 미리보기 페이지
// 큰 화면에서 마커별 설명 편집 + 단계 관리
// ========================================

const params = new URLSearchParams(location.search);
const title = params.get('title') || '매뉴얼';

let allSteps = [];

// ── 초기 로드 ──
loadAndRender();

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
    div.className = 'step';

    // ── 좌측: 헤더 + 스크린샷 ──
    const left = document.createElement('div');
    left.className = 'step-left';

    const header = document.createElement('div');
    header.className = 'step-header';

    const headerLeft = document.createElement('div');
    headerLeft.className = 'step-header-left';
    const num = document.createElement('span');
    num.className = 'step-num';
    num.textContent = `Step ${step.stepNumber}`;
    const url = document.createElement('span');
    url.className = 'step-url';
    url.textContent = step.pageTitle || '';
    headerLeft.appendChild(num);
    headerLeft.appendChild(url);

    // 단계 관리 버튼들
    const headerActions = document.createElement('div');
    headerActions.className = 'step-header-actions';

    const editBtn = document.createElement('button');
    editBtn.textContent = '✏️ 편집기';
    editBtn.title = '그리기 편집기 열기';
    editBtn.addEventListener('click', () => {
      const editorUrl = chrome.runtime.getURL('editor/editor.html') + '?step=' + si;
      chrome.tabs.create({ url: editorUrl });
    });

    const upBtn = document.createElement('button');
    upBtn.textContent = '⬆️';
    upBtn.title = '위로';
    upBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'MOVE_STEP', from: si, to: si - 1 }, () => loadAndRender());
    });

    const downBtn = document.createElement('button');
    downBtn.textContent = '⬇️';
    downBtn.title = '아래로';
    downBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'MOVE_STEP', from: si, to: si + 1 }, () => loadAndRender());
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'del-btn';
    delBtn.textContent = '🗑️';
    delBtn.title = '이 단계 삭제';
    delBtn.addEventListener('click', () => {
      if (!confirm(`Step ${step.stepNumber}을 삭제하시겠습니까?`)) return;
      chrome.runtime.sendMessage({ type: 'DELETE_STEP', index: si }, () => loadAndRender());
    });

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
    left.appendChild(img);

    // ── 우측: 마커별 편집 가능 설명 ──
    const right = document.createElement('div');
    right.className = 'step-right';

    const rightHeader = document.createElement('div');
    rightHeader.className = 'step-right-header';
    const rightTitle = document.createElement('span');
    rightTitle.textContent = '설명 (편집 가능)';
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

    markers.forEach((marker, mi) => {
      const row = document.createElement('div');
      row.className = 'step-marker-row';

      // 좌측: 번호 + 삭제
      const rowLeft = document.createElement('div');
      rowLeft.className = 'marker-row-left';

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

      // 우측: 요소 정보 + 설명 편집
      const content = document.createElement('div');
      content.className = 'marker-content';

      const elText = marker.element?.text || '';
      const elTag = (marker.element?.tag || '').toLowerCase();
      if (elText || elTag) {
        const tag = document.createElement('div');
        tag.className = 'marker-el-tag';
        tag.textContent = `📍 ${elText ? '"' + elText + '"' : ''} ${elTag}`;
        content.appendChild(tag);
      }

      // 편집 가능한 textarea
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

// ── HTML 내보내기 ──
document.getElementById('exportHtmlBtn').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'GET_STEPS' }, (response) => {
    if (!response?.steps?.length) { alert('데이터가 없습니다.'); return; }
    exportToHTML(title, response.steps);
  });
});

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
  return `<div class="step">
  <div class="step-left">
    <div class="step-header">
      <span class="step-num">Step ${step.stepNumber}</span>
      <span class="step-url">${esc(step.pageTitle||'')}</span>
    </div>
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

// ── 편집기 저장 후 자동 새로고침 ──
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'EDITOR_SAVED') {
    loadAndRender();
  }
});
