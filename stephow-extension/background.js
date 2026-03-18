// ========================================
// background.js — Service Worker
// 역할: 녹화 상태 관리, 스크린샷 캡처
// ========================================

// 녹화 상태
let isRecording = false;
let steps = [];
let captureMode = 'per-click';
let globalClickNumber = 0;

// Service Worker 재시작 시 저장된 데이터 복구
chrome.storage.local.get(['stepsData', 'captureMode'], (result) => {
  if (result.stepsData?.length) {
    steps = result.stepsData;
  }
  if (result.captureMode) {
    captureMode = result.captureMode;
  }
});

// steps 변경 시 storage에 영속화
function persistSteps() {
  chrome.storage.local.set({ stepsData: steps });
}

// 확장 아이콘 클릭 → 사이드 패널 열기
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// 새 탭/팝업이 로딩 완료되면 녹화 상태 자동 전파
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (isRecording && changeInfo.status === 'complete') {
    chrome.tabs.sendMessage(tabId, {
      type: 'RECORDING_STATE_CHANGED',
      isRecording: true
    }).catch(() => {});
  }
});

// 메시지 수신 처리
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'START_RECORDING') {
    isRecording = true;
    steps = [];
    globalClickNumber = 0;
    persistSteps();
    chrome.action.setBadgeText({ text: 'REC' });
    chrome.action.setBadgeBackgroundColor({ color: '#FF0000' });
    broadcastToAllTabs(true);
    sendResponse({ success: true, isRecording: true });
    return true;
  }

  if (message.type === 'STOP_RECORDING') {
    isRecording = false;
    chrome.action.setBadgeText({ text: '' });
    broadcastToAllTabs(false);
    persistSteps(); // 녹화 중지 시 저장
    sendResponse({ success: true, isRecording: false, steps: steps });
    return true;
  }

  if (message.type === 'SET_CAPTURE_MODE') {
    captureMode = message.mode;
    chrome.storage.local.set({ captureMode });
    sendResponse({ success: true, mode: captureMode });
    return true;
  }

  if (message.type === 'GET_STATUS') {
    sendResponse({ isRecording, stepCount: steps.length });
    return true;
  }

  if (message.type === 'GET_STEPS') {
    sendResponse({ steps });
    return true;
  }

  if (message.type === 'DELETE_STEP') {
    steps = steps.filter((_, i) => i !== message.index);
    steps.forEach((s, i) => s.stepNumber = i + 1);
    persistSteps();
    sendResponse({ success: true, steps });
    return true;
  }

  if (message.type === 'UPDATE_DESCRIPTION') {
    if (steps[message.index]) {
      steps[message.index].description = message.description;
    }
    sendResponse({ success: true });
    return true;
  }

  // 마커별 설명 업데이트
  if (message.type === 'UPDATE_MARKER_DESC') {
    const step = steps[message.stepIndex];
    if (step?.markers?.[message.markerIndex]) {
      step.markers[message.markerIndex].description = message.description;
      // 통합 설명도 갱신
      step.description = step.markers
        .map((m, i) => `${i + 1}. ${m.description || ''}`)
        .filter(d => d.length > 3)
        .join('\n');
    }
    sendResponse({ success: true });
    return true;
  }

  // 마커 삭제 + 이미지 재생성
  if (message.type === 'DELETE_MARKER') {
    const step = steps[message.stepIndex];
    if (step?.markers) {
      step.markers.splice(message.markerIndex, 1);
      // 번호 재정렬
      step.markers.forEach((m, i) => m.number = i + 1);
      // 설명 갱신
      step.description = step.markers
        .map((m, i) => `${i + 1}. ${m.description || ''}`)
        .filter(d => d.length > 3)
        .join('\n');
      // 이미지 재생성
      regenerateMarkedImage(step).then(() => {
        sendResponse({ success: true, step });
      });
    } else {
      sendResponse({ success: false });
    }
    return true;
  }

  // 마커 수동 추가 + 이미지 재생성
  if (message.type === 'ADD_MARKER') {
    const step = steps[message.stepIndex];
    if (step) {
      if (!step.markers) step.markers = [];
      const newNumber = step.markers.length + 1;
      step.markers.push({
        x: message.x,
        y: message.y,
        number: newNumber,
        elementRect: message.elementRect || null,
        element: { tag: '', text: '' },
        description: ''
      });
      // 이미지 재생성
      regenerateMarkedImage(step).then(() => {
        sendResponse({ success: true, step });
      });
    } else {
      sendResponse({ success: false });
    }
    return true;
  }

  // 편집기에서 저장
  if (message.type === 'SAVE_EDITOR') {
    const step = steps[message.stepIndex];
    if (step) {
      step.markers = message.markers;
      step.screenshotWithMarker = message.screenshotWithMarker;
      step.description = message.description;
      persistSteps();
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false });
    }
    return true;
  }

  // 편집기 저장 완료 알림 (사이드 패널이 수신)
  if (message.type === 'EDITOR_SAVED') {
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'MOVE_STEP') {
    const { from, to } = message;
    if (from >= 0 && from < steps.length && to >= 0 && to < steps.length) {
      const [moved] = steps.splice(from, 1);
      steps.splice(to, 0, moved);
      steps.forEach((s, i) => s.stepNumber = i + 1);
      persistSteps();
    }
    sendResponse({ success: true, steps });
    return true;
  }

  if (message.type === 'CLICK_EVENT') {
    if (!isRecording) {
      sendResponse({ captured: false });
      return true;
    }

    const clickData = message.data;
    // 탭의 메인 URL 사용 (iframe URL이 아닌 실제 탭 URL로 비교)
    const tabUrl = sender.tab?.url || clickData.pageUrl;

    chrome.tabs.captureVisibleTab(null, {
      format: 'jpeg',
      quality: 80
    }).then(async (dataUrl) => {
      globalClickNumber++;

      if (captureMode === 'per-page' && steps.length > 0) {
        // === 화면당 1장 모드 ===
        const lastStep = steps[steps.length - 1];

        // 같은 페이지인지 확인 (탭 URL 기준)
        const isSamePage = isSamePageUrl(lastStep.tabUrl || lastStep.pageUrl, tabUrl);

        const markerCount = lastStep.markers ? lastStep.markers.length : 1;

        if (isSamePage && markerCount < 10) {
          // 같은 페이지 + 10개 미만 → 기존 스크린샷에 새 마커 추가
          const newMarkerNumber = markerCount + 1;

          // 마커 목록에 추가
          if (!lastStep.markers) {
            lastStep.markers = [{
              x: lastStep.clickX,
              y: lastStep.clickY,
              number: 1,
              elementRect: lastStep.elementRect,
              element: lastStep.element,
              description: lastStep.element?.autoDescription || ''
            }];
          }
          const newAutoDesc = clickData.element.autoDescription || '';
          lastStep.markers.push({
            x: clickData.x,
            y: clickData.y,
            number: newMarkerNumber,
            elementRect: clickData.elementRect,
            element: clickData.element,
            description: newAutoDesc
          });

          // 원본 스크린샷 위에 모든 마커를 다시 그리기
          const markedDataUrl = await addMultipleMarkers(
            dataUrl,
            lastStep.markers,
            clickData.viewport
          );

          lastStep.screenshotWithMarker = markedDataUrl;
          lastStep.screenshot = dataUrl; // 최신 스크린샷으로 갱신
          // 설명에 새 동작 추가
          const newDesc = clickData.element.autoDescription || '';
          if (newDesc) {
            lastStep.description += `\n${newMarkerNumber}. ${newDesc}`;
          }

          // 사이드 패널에 업데이트 알림
          chrome.runtime.sendMessage({
            type: 'UPDATE_STEP',
            step: lastStep,
            index: steps.length - 1
          }).catch(() => {});

          sendResponse({ captured: true, stepNumber: lastStep.stepNumber, merged: true });
          return;
        }
      }

      // === 클릭당 1장 모드 (기본) 또는 새 페이지 ===
      const stepNumber = steps.length + 1;

      const markedDataUrl = await addClickMarker(
        dataUrl,
        clickData.x,
        clickData.y,
        captureMode === 'per-page' ? 1 : stepNumber,
        clickData.viewport,
        clickData.elementRect
      );

      // 항상 markers 배열 생성 (편집 기능 통일)
      const autoDesc = clickData.element.autoDescription || '';
      const step = {
        stepNumber,
        screenshot: dataUrl,
        screenshotWithMarker: markedDataUrl,
        pageUrl: clickData.pageUrl,
        pageTitle: clickData.pageTitle,
        tabUrl: tabUrl,
        clickX: clickData.x,
        clickY: clickData.y,
        elementRect: clickData.elementRect,
        element: clickData.element,
        viewport: clickData.viewport,
        description: captureMode === 'per-page'
          ? `1. ${autoDesc}` : autoDesc,
        timestamp: clickData.timestamp,
        markers: [{
          x: clickData.x,
          y: clickData.y,
          number: 1,
          elementRect: clickData.elementRect,
          element: clickData.element,
          description: autoDesc
        }]
      };

      steps.push(step);
      persistSteps();

      chrome.runtime.sendMessage({
        type: 'NEW_STEP',
        step: step
      }).catch(() => {});

      sendResponse({ captured: true, stepNumber });
    }).catch((err) => {
      console.error('캡처 실패:', err);
      sendResponse({ captured: false, error: err.message });
    });

    return true;
  }

  return false;
});

// 원본 스크린샷에 마커를 다시 그려서 screenshotWithMarker를 갱신
async function regenerateMarkedImage(step) {
  if (!step.screenshot) return;
  if (!step.markers || step.markers.length === 0) {
    step.screenshotWithMarker = step.screenshot;
    return;
  }
  // viewport 정보 복원 (step에 저장된 것 사용)
  const viewport = step.viewport || { width: 1920, height: 1080, devicePixelRatio: 1 };
  step.screenshotWithMarker = await addMultipleMarkers(step.screenshot, step.markers, viewport);
}

// 같은 페이지인지 확인 (URL의 origin + pathname 기준, query/hash 무시)
function isSamePageUrl(url1, url2) {
  try {
    const a = new URL(url1);
    const b = new URL(url2);
    return a.origin + a.pathname === b.origin + b.pathname;
  } catch {
    return url1 === url2;
  }
}

// 여러 마커를 한 이미지에 그리기 (화면당 1장 모드)
async function addMultipleMarkers(dataUrl, markers, viewport) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);

  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0);

  const scaleX = bitmap.width / viewport.width;
  const scaleY = bitmap.height / viewport.height;

  for (const marker of markers) {
    const eRect = marker.elementRect;

    if (eRect && eRect.width > 0 && eRect.height > 0) {
      // 라운드 사각형
      const padding = 6 * scaleX;
      const rx = eRect.x * scaleX - padding;
      const ry = eRect.y * scaleY - padding;
      const rw = eRect.width * scaleX + padding * 2;
      const rh = eRect.height * scaleY + padding * 2;
      const borderRadius = 8 * scaleX;

      ctx.save();
      ctx.beginPath();
      drawRoundRect(ctx, rx, ry, rw, rh, borderRadius);
      ctx.fillStyle = 'rgba(230, 50, 50, 0.08)';
      ctx.fill();
      ctx.shadowColor = 'rgba(230, 50, 50, 0.3)';
      ctx.shadowBlur = 12 * scaleX;
      ctx.strokeStyle = 'rgba(230, 50, 50, 0.85)';
      ctx.lineWidth = 3 * scaleX;
      ctx.stroke();
      ctx.restore();

      // 번호 배지
      const badgeSize = 26 * scaleX;
      const badgeX = rx - badgeSize * 0.3;
      const badgeY = ry - badgeSize * 0.3;

      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(badgeX + badgeSize / 2, badgeY + badgeSize / 2, badgeSize / 2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(230, 50, 50, 0.95)';
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.5 * scaleX;
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${Math.round(14 * scaleX)}px -apple-system, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(marker.number), badgeX + badgeSize / 2, badgeY + badgeSize / 2);
    } else {
      // 폴백: 빨간 원
      const mx = marker.x * scaleX;
      const my = marker.y * scaleY;
      const r = 22 * scaleX;

      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(mx, my, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(230, 50, 50, 0.9)';
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3 * scaleX;
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${Math.round(16 * scaleX)}px -apple-system, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(marker.number), mx, my);
    }
  }

  bitmap.close();
  const resultBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(resultBlob);
  });
}

// 모든 탭의 content script에 녹화 상태를 알려주는 함수
function broadcastToAllTabs(recording) {
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, {
        type: 'RECORDING_STATE_CHANGED',
        isRecording: recording
      }).catch(() => {});
    }
  });
}


// 클릭 위치에 라운드 사각형 + 번호 배지를 그리는 함수
async function addClickMarker(dataUrl, clickX, clickY, stepNumber, viewport, elementRect) {
  // dataUrl → ImageBitmap
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);

  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');

  // 원본 이미지 그리기
  ctx.drawImage(bitmap, 0, 0);

  // 뷰포트 → 이미지 좌표 변환 비율
  const scaleX = bitmap.width / viewport.width;
  const scaleY = bitmap.height / viewport.height;

  // --- 1) 라운드 사각형으로 클릭 요소 하이라이트 ---
  if (elementRect && elementRect.width > 0 && elementRect.height > 0) {
    const padding = 6 * scaleX; // 요소보다 살짝 크게
    const rx = elementRect.x * scaleX - padding;
    const ry = elementRect.y * scaleY - padding;
    const rw = elementRect.width * scaleX + padding * 2;
    const rh = elementRect.height * scaleY + padding * 2;
    const borderRadius = 8 * scaleX;

    // 반투명 빨간 배경 채우기
    ctx.save();
    ctx.beginPath();
    drawRoundRect(ctx, rx, ry, rw, rh, borderRadius);
    ctx.fillStyle = 'rgba(230, 50, 50, 0.08)';
    ctx.fill();

    // 빨간 테두리 (그림자 포함)
    ctx.shadowColor = 'rgba(230, 50, 50, 0.3)';
    ctx.shadowBlur = 12 * scaleX;
    ctx.strokeStyle = 'rgba(230, 50, 50, 0.85)';
    ctx.lineWidth = 3 * scaleX;
    ctx.stroke();
    ctx.restore();

    // --- 2) 번호 배지: 라운드 사각형 좌측 상단에 표시 ---
    const badgeSize = 26 * scaleX;
    const badgeX = rx - badgeSize * 0.3;
    const badgeY = ry - badgeSize * 0.3;

    // 배지 원
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 1;

    ctx.beginPath();
    ctx.arc(badgeX + badgeSize / 2, badgeY + badgeSize / 2, badgeSize / 2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(230, 50, 50, 0.95)';
    ctx.fill();

    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5 * scaleX;
    ctx.stroke();
    ctx.restore();

    // 배지 번호
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${Math.round(14 * scaleX)}px -apple-system, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(stepNumber), badgeX + badgeSize / 2, badgeY + badgeSize / 2);

  } else {
    // elementRect가 없으면 기존 방식 (빨간 원)으로 폴백
    const markerX = clickX * scaleX;
    const markerY = clickY * scaleY;
    const radius = 22 * scaleX;

    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;

    ctx.beginPath();
    ctx.arc(markerX, markerY, radius, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(230, 50, 50, 0.9)';
    ctx.fill();

    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3 * scaleX;
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${Math.round(16 * scaleX)}px -apple-system, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(stepNumber), markerX, markerY);
  }

  bitmap.close();

  // Canvas → dataUrl
  const resultBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(resultBlob);
  });
}

// 라운드 사각형 경로 그리기 헬퍼
function drawRoundRect(ctx, x, y, width, height, radius) {
  radius = Math.min(radius, width / 2, height / 2);
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.arcTo(x + width, y, x + width, y + radius, radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.arcTo(x + width, y + height, x + width - radius, y + height, radius);
  ctx.lineTo(x + radius, y + height);
  ctx.arcTo(x, y + height, x, y + height - radius, radius);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
}
