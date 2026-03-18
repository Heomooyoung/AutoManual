// ========================================
// viewer.js — 매뉴얼 미리보기 페이지
// 좌측 캡처 + 우측 설명 레이아웃
// ========================================

document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(location.search);
  const title = params.get('title') || '매뉴얼';

  chrome.runtime.sendMessage({ type: 'GET_STEPS' }, (response) => {
    if (chrome.runtime.lastError || !response?.steps?.length) {
      document.getElementById('stepContainer').innerHTML =
        '<p style="text-align:center; color:#6b7b9e; padding:40px;">미리볼 데이터가 없습니다.</p>';
      return;
    }

    const steps = response.steps;

    document.getElementById('manualTitle').textContent = title;
    document.getElementById('manualMeta').textContent =
      `작성일: ${new Date().toLocaleDateString('ko-KR')} | 총 ${steps.length}단계`;
    document.title = `${title} — 미리보기`;

    const container = document.getElementById('stepContainer');
    steps.forEach(step => {
      const div = document.createElement('div');
      div.className = 'step';

      // 좌측: 헤더 + 스크린샷
      const left = document.createElement('div');
      left.className = 'step-left';

      const header = document.createElement('div');
      header.className = 'step-header';
      const num = document.createElement('span');
      num.className = 'step-num';
      num.textContent = `Step ${step.stepNumber}`;
      const url = document.createElement('span');
      url.className = 'step-url';
      url.textContent = step.pageTitle || '';
      header.appendChild(num);
      header.appendChild(url);

      const img = document.createElement('img');
      img.src = step.screenshotWithMarker;
      img.alt = `Step ${step.stepNumber}`;

      left.appendChild(header);
      left.appendChild(img);

      // 우측: 마커별 설명
      const right = document.createElement('div');
      right.className = 'step-right';

      const rightHeader = document.createElement('div');
      rightHeader.className = 'step-right-header';
      rightHeader.textContent = '설명';
      right.appendChild(rightHeader);

      const markers = step.markers || [];
      if (markers.length > 0) {
        markers.forEach((marker, mi) => {
          const row = document.createElement('div');
          row.className = 'step-marker-row';

          const badge = document.createElement('span');
          badge.className = 'step-marker-badge';
          badge.textContent = mi + 1;

          const text = document.createElement('span');
          text.className = 'step-marker-text';
          text.textContent = marker.description || '(설명 없음)';

          row.appendChild(badge);
          row.appendChild(text);
          right.appendChild(row);
        });
      } else {
        const desc = document.createElement('div');
        desc.className = 'step-desc';
        desc.textContent = step.description || '(설명 없음)';
        right.appendChild(desc);
      }

      div.appendChild(left);
      div.appendChild(right);
      container.appendChild(div);
    });
  });
});
