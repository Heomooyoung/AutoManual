// ========================================
// background.js — Service Worker
// 역할: 녹화 상태 관리, 스크린샷 캡처
// ========================================

// 녹화 상태
let isRecording = false;
let steps = [];
let captureMode = 'per-click';
let globalClickNumber = 0;
let reRecordTarget = null; // { stepIndex: number, newSteps: [] } — 재녹화 대상
let modeJustSwitched = false; // 모드 전환 직후 플래그

// Service Worker 재시작 시 저장된 데이터 복구
chrome.storage.local.get(['stepsData', 'captureMode', 'isRecordingState'], (result) => {
  if (result.stepsData?.length) {
    steps = result.stepsData;
  }
  if (result.captureMode) {
    captureMode = result.captureMode;
  }
  if (result.isRecordingState) {
    isRecording = true;
    chrome.action.setBadgeText({ text: 'REC' });
    chrome.action.setBadgeBackgroundColor({ color: '#FF0000' });
    broadcastToAllTabs(true);
  }
});

// steps 변경 시 storage에 영속화 (배치 처리: 연속 클릭 시 마지막 1회만 저장)
let persistTimer = null;
function persistSteps() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    chrome.storage.local.set({ stepsData: steps });
    persistTimer = null;
  }, 500);
}
// 즉시 저장이 필요한 경우 (녹화 중지 등)
function persistStepsNow() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = null;
  chrome.storage.local.set({ stepsData: steps });
}

// 확장 아이콘 클릭 → 사이드 패널 열기
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// 글로벌 단축키 (Ctrl+Shift+E) → 녹화 토글
chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-recording') {
    if (isRecording) {
      isRecording = false;
      chrome.storage.local.set({ isRecordingState: false });
      chrome.action.setBadgeText({ text: '' });
      broadcastToAllTabs(false);
      persistStepsNow();
    } else {
      isRecording = true;
      chrome.storage.local.set({ isRecordingState: true });
      chrome.action.setBadgeText({ text: 'REC' });
      chrome.action.setBadgeBackgroundColor({ color: '#FF0000' });
      broadcastToAllTabs(true);
    }
    // sidepanel에 상태 변경 알림
    chrome.runtime.sendMessage({ type: 'RECORDING_TOGGLED', isRecording }).catch(() => {});
  }
});

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
  // 이어서 녹화 (기존 steps 유지)
  if (message.type === 'START_RECORDING') {
    isRecording = true;
    chrome.storage.local.set({ isRecordingState: true });
    chrome.action.setBadgeText({ text: 'REC' });
    chrome.action.setBadgeBackgroundColor({ color: '#FF0000' });
    broadcastToAllTabs(true);
    sendResponse({ success: true, isRecording: true, steps });
    return true;
  }

  // 신규 녹화 (초기화)
  if (message.type === 'NEW_RECORDING') {
    isRecording = false;
    steps = [];
    globalClickNumber = 0;
    chrome.storage.local.set({ isRecordingState: false });
    persistStepsNow();
    chrome.action.setBadgeText({ text: '' });
    broadcastToAllTabs(false);
    sendResponse({ success: true, steps: [] });
    return true;
  }

  if (message.type === 'STOP_RECORDING') {
    isRecording = false;
    chrome.storage.local.set({ isRecordingState: false });
    chrome.action.setBadgeText({ text: '' });
    broadcastToAllTabs(false);
    persistStepsNow();
    sendResponse({ success: true, isRecording: false, steps: steps });
    return true;
  }

  if (message.type === 'SET_CAPTURE_MODE') {
    captureMode = message.mode;
    modeJustSwitched = true; // 다음 캡처는 새 step으로 시작
    chrome.storage.local.set({ captureMode });
    sendResponse({ success: true, mode: captureMode });
    return true;
  }

  if (message.type === 'GET_STATUS') {
    sendResponse({ isRecording, stepCount: steps.length, captureMode });
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

  // 일괄 삭제
  if (message.type === 'DELETE_STEPS_MULTI') {
    const indices = new Set(message.indices || []);
    steps = steps.filter((_, i) => !indices.has(i));
    steps.forEach((s, i) => s.stepNumber = i + 1);
    persistSteps();
    sendResponse({ success: true, steps });
    return true;
  }

  // 수동 캡처 (클릭 없이 현재 화면 캡처)
  if (message.type === 'MANUAL_CAPTURE') {
    if (!isRecording) {
      sendResponse({ captured: false, error: '녹화 중이 아닙니다' });
      return true;
    }

    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      if (!tabs[0]) {
        sendResponse({ captured: false, error: '활성 탭을 찾을 수 없습니다' });
        return;
      }
      const tab = tabs[0];
      chrome.tabs.captureVisibleTab(tab.windowId, {
        format: 'jpeg',
        quality: 80
      }).then((dataUrl) => {
        const stepNumber = steps.length + 1;
        const step = {
          stepNumber,
          screenshot: dataUrl,
          screenshotWithMarker: dataUrl,
          pageUrl: tab.url || '',
          pageTitle: tab.title || '',
          tabUrl: tab.url || '',
          clickX: 0,
          clickY: 0,
          elementRect: null,
          element: { tag: '', text: '' },
          viewport: { width: tab.width || 1920, height: tab.height || 1080, devicePixelRatio: 1 },
          description: '',
          timestamp: Date.now(),
          markers: []
        };
        steps.push(step);
        persistSteps();

        chrome.runtime.sendMessage({
          type: 'NEW_STEP',
          step: step
        }).catch(() => {});

        sendResponse({ captured: true, stepNumber });
      }).catch((err) => {
        console.error('수동 캡처 실패:', err);
        sendResponse({ captured: false, error: err.message });
      });
    });
    return true;
  }

  if (message.type === 'UPDATE_DESCRIPTION') {
    if (steps[message.index]) {
      steps[message.index].description = message.description;
      persistSteps();
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
      persistSteps();
    }
    sendResponse({ success: true });
    return true;
  }

  // 마커 순서 변경 (드래그 앤 드롭)
  if (message.type === 'REORDER_MARKERS') {
    const step = steps[message.stepIndex];
    if (step?.markers && message.newOrder) {
      // newOrder는 새 인덱스 배열 (예: [2, 0, 1])
      const reordered = message.newOrder.map(i => step.markers[i]);
      // 번호 재정렬 (1, 2, 3...)
      reordered.forEach((m, i) => m.number = i + 1);
      step.markers = reordered;
      // 설명 갱신
      step.description = step.markers
        .map((m, i) => `${i + 1}. ${m.description || ''}`)
        .filter(d => d.length > 3)
        .join('\n');
      // 이미지 재생성 (마커 번호가 바뀌었으므로)
      regenerateMarkedImage(step).then(() => {
        persistStepsNow();
        sendResponse({ success: true, step });
      });
    } else {
      sendResponse({ success: false });
    }
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
        persistSteps();
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
        persistSteps();
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
      if (message.screenshot) step.screenshot = message.screenshot;
      step.description = message.description;
      // 변경 추적
      step.modified = true;
      step.modifiedAt = Date.now();
      step.changeType = 'edited';
      step.changeSummary = '편집기에서 수정되었습니다';
      persistStepsNow();
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

  // ─── 파일에서 steps 불러오기 ───
  if (message.type === 'LOAD_FILE_STEPS') {
    steps = message.steps || [];
    steps.forEach((s, i) => s.stepNumber = i + 1);
    persistStepsNow();
    sendResponse({ success: true, steps });
    return true;
  }

  // ─── 매뉴얼 저장 ───
  if (message.type === 'SAVE_MANUAL') {
    const manual = {
      id: 'manual_' + Date.now(),
      title: message.title || '제목 없음',
      savedAt: Date.now(),
      stepCount: steps.length,
      steps: JSON.parse(JSON.stringify(steps))
    };
    chrome.storage.local.get(['savedManuals'], (result) => {
      const manuals = result.savedManuals || [];
      manuals.unshift(manual);
      // 최대 20개 유지
      if (manuals.length > 20) manuals.length = 20;
      chrome.storage.local.set({ savedManuals: manuals }, () => {
        sendResponse({ success: true, manual: { id: manual.id, title: manual.title, savedAt: manual.savedAt, stepCount: manual.stepCount } });
      });
    });
    return true;
  }

  // ─── 저장된 매뉴얼 목록 조회 ───
  if (message.type === 'GET_MANUALS') {
    chrome.storage.local.get(['savedManuals'], (result) => {
      const manuals = (result.savedManuals || []).map(m => ({
        id: m.id,
        title: m.title,
        savedAt: m.savedAt,
        stepCount: m.stepCount
      }));
      sendResponse({ manuals });
    });
    return true;
  }

  // ─── 매뉴얼 불러오기 ───
  if (message.type === 'LOAD_MANUAL') {
    chrome.storage.local.get(['savedManuals'], (result) => {
      const manuals = result.savedManuals || [];
      const found = manuals.find(m => m.id === message.manualId);
      if (found) {
        // 기존 steps를 불러온 매뉴얼로 교체, 원본 스냅샷 저장
        steps = found.steps.map(s => ({
          ...s,
          _original: {
            screenshot: s.screenshot,
            screenshotWithMarker: s.screenshotWithMarker,
            description: s.description,
            markers: JSON.parse(JSON.stringify(s.markers || []))
          },
          modified: false,
          modifiedAt: null,
          changeType: null,
          changeSummary: null
        }));
        persistSteps();
        sendResponse({ success: true, title: found.title, steps });
      } else {
        sendResponse({ success: false, error: '매뉴얼을 찾을 수 없습니다' });
      }
    });
    return true;
  }

  // ─── 매뉴얼 삭제 ───
  if (message.type === 'DELETE_MANUAL') {
    chrome.storage.local.get(['savedManuals'], (result) => {
      let manuals = result.savedManuals || [];
      manuals = manuals.filter(m => m.id !== message.manualId);
      chrome.storage.local.set({ savedManuals: manuals }, () => {
        sendResponse({ success: true });
      });
    });
    return true;
  }

  // ─── 재녹화 시작 (특정 단계) ───
  if (message.type === 'START_RE_RECORD') {
    reRecordTarget = { stepIndex: message.stepIndex, newSteps: [] };
    isRecording = true;
    chrome.action.setBadgeText({ text: 'RE' });
    chrome.action.setBadgeBackgroundColor({ color: '#7C3AED' });
    broadcastToAllTabs(true);
    sendResponse({ success: true });
    return true;
  }

  // ─── 재녹화 취소 (원래 상태 복원) ───
  if (message.type === 'CANCEL_RE_RECORD') {
    reRecordTarget = null;
    isRecording = false;
    chrome.action.setBadgeText({ text: '' });
    broadcastToAllTabs(false);
    sendResponse({ success: true });
    return true;
  }

  // ─── 재녹화 완료 (캡처한 것들로 교체) ───
  if (message.type === 'FINISH_RE_RECORD') {
    if (!reRecordTarget || reRecordTarget.newSteps.length === 0) {
      reRecordTarget = null;
      isRecording = false;
      chrome.action.setBadgeText({ text: '' });
      broadcastToAllTabs(false);
      sendResponse({ success: false, error: '캡처된 단계가 없습니다' });
      return true;
    }

    const idx = reRecordTarget.stepIndex;
    const newSteps = reRecordTarget.newSteps;

    // 원래 1개 단계를 제거하고, 그 자리에 새 단계들을 삽입
    steps.splice(idx, 1, ...newSteps);

    // 전체 stepNumber 재정렬
    steps.forEach((s, i) => s.stepNumber = i + 1);
    persistStepsNow();

    reRecordTarget = null;
    isRecording = false;
    chrome.action.setBadgeText({ text: '' });
    broadcastToAllTabs(false);

    chrome.runtime.sendMessage({ type: 'RE_RECORD_DONE', steps }).catch(() => {});
    sendResponse({ success: true, steps });
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
      // ─── 재녹화 모드: 캡처를 누적 (완료 버튼으로 확정) ───
      if (reRecordTarget !== null) {
        const autoDesc = clickData.element.autoDescription || '';
        const existingSteps = reRecordTarget.newSteps;

        // 화면당 1장 모드: 같은 페이지면 기존 마지막 스텝에 마커 추가
        if (captureMode === 'per-page' && existingSteps.length > 0) {
          const lastNew = existingSteps[existingSteps.length - 1];
          const isSamePage = isSamePageUrl(lastNew.tabUrl || lastNew.pageUrl, tabUrl);

          if (isSamePage && lastNew.markers && lastNew.markers.length < 10) {
            const newMarkerNum = lastNew.markers.length + 1;
            lastNew.markers.push({
              x: clickData.x, y: clickData.y, number: newMarkerNum,
              elementRect: clickData.elementRect,
              element: clickData.element,
              description: autoDesc
            });

            // 원본 스크린샷 위에 모든 마커 다시 그리기
            const markedDataUrl = await addMultipleMarkers(
              dataUrl, lastNew.markers, clickData.viewport
            );
            lastNew.screenshot = dataUrl;
            lastNew.screenshotWithMarker = markedDataUrl;
            lastNew.description = lastNew.markers
              .map((m, i) => `${i + 1}. ${m.description || ''}`)
              .filter(d => d.length > 3)
              .join('\n');

            const totalSteps = existingSteps.length;
            chrome.action.setBadgeText({ text: `RE${totalSteps}` });

            chrome.runtime.sendMessage({
              type: 'RE_RECORD_PROGRESS',
              stepIndex: reRecordTarget.stepIndex,
              capturedCount: totalSteps,
              thumbnail: markedDataUrl,
              merged: true
            }).catch(() => {});

            sendResponse({ captured: true, reRecording: true, capturedCount: totalSteps, merged: true });
            return;
          }
        }

        // 클릭당 1장 모드 또는 새 페이지
        const newNum = existingSteps.length + 1;
        const markerNumber = captureMode === 'per-page' ? 1 : newNum;

        const markedDataUrl = await addClickMarker(
          dataUrl, clickData.x, clickData.y, markerNumber,
          clickData.viewport, clickData.elementRect
        );

        const newStep = {
          stepNumber: newNum,
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
            x: clickData.x, y: clickData.y, number: 1,
            elementRect: clickData.elementRect,
            element: clickData.element,
            description: autoDesc
          }],
          modified: true,
          modifiedAt: Date.now(),
          changeType: 're-recorded',
          changeSummary: `재녹화 (${newNum}장)`
        };

        existingSteps.push(newStep);

        chrome.action.setBadgeText({ text: `RE${newNum}` });

        chrome.runtime.sendMessage({
          type: 'RE_RECORD_PROGRESS',
          stepIndex: reRecordTarget.stepIndex,
          capturedCount: newNum,
          thumbnail: markedDataUrl
        }).catch(() => {});

        sendResponse({ captured: true, reRecording: true, capturedCount: newNum });
        return;
      }

      globalClickNumber++;

      if (captureMode === 'per-page' && steps.length > 0 && !modeJustSwitched) {
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
          lastStep.screenshot = dataUrl;
          // 설명을 마커별로 재생성
          lastStep.description = lastStep.markers
            .map((m, i) => `${i + 1}. ${m.description || ''}`)
            .filter(d => d.length > 3)
            .join('\n');

          // 사이드 패널에 업데이트 알림
          chrome.runtime.sendMessage({
            type: 'UPDATE_STEP',
            step: lastStep,
            index: steps.length - 1
          }).catch(() => {});

          persistSteps();
          sendResponse({ captured: true, stepNumber: lastStep.stepNumber, merged: true });
          return;
        }
      }

      // === 클릭당 1장 모드 (기본) 또는 새 페이지 ===
      modeJustSwitched = false; // 새 step 생성 시 플래그 리셋
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

      // 번호 배지 (화면 밖으로 나가지 않게 클램핑)
      const badgeSize = 26 * scaleX;
      let badgeX = rx - badgeSize * 0.3;
      let badgeY = ry - badgeSize * 0.3;
      if (badgeX < 2) badgeX = 2;
      if (badgeY < 2) badgeY = 2;
      if (badgeX + badgeSize > canvas.width - 2) badgeX = canvas.width - badgeSize - 2;
      if (badgeY + badgeSize > canvas.height - 2) badgeY = canvas.height - badgeSize - 2;

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
  const arrayBuffer = await resultBlob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return 'data:image/jpeg;base64,' + btoa(binary);
}

// 모든 탭의 content script에 녹화 상태를 알려주는 함수
function broadcastToAllTabs(recording) {
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      // chrome:// , edge:// 등 내부 페이지는 스킵
      if (!tab.url || tab.url.startsWith('chrome') || tab.url.startsWith('edge') || tab.url.startsWith('about')) continue;

      chrome.tabs.sendMessage(tab.id, {
        type: 'RECORDING_STATE_CHANGED',
        isRecording: recording
      }).catch(() => {
        // 메시지 전송 실패 → content script가 없는 탭 → 주입 후 재전송
        chrome.scripting.executeScript({
          target: { tabId: tab.id, allFrames: true },
          files: ['content.js']
        }).then(() => {
          // 주입 후 녹화 상태 전달
          chrome.tabs.sendMessage(tab.id, {
            type: 'RECORDING_STATE_CHANGED',
            isRecording: recording
          }).catch(() => {});
        }).catch(() => {});
      });
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

    // --- 2) 번호 배지: 라운드 사각형 좌측 상단 (화면 밖으로 안 나가게) ---
    const badgeSize = 26 * scaleX;
    let badgeX = rx - badgeSize * 0.3;
    let badgeY = ry - badgeSize * 0.3;
    if (badgeX < 2) badgeX = 2;
    if (badgeY < 2) badgeY = 2;
    if (badgeX + badgeSize > bitmap.width - 2) badgeX = bitmap.width - badgeSize - 2;
    if (badgeY + badgeSize > bitmap.height - 2) badgeY = bitmap.height - badgeSize - 2;

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

  // Canvas → dataUrl (FileReader 없이 직접 변환)
  const resultBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
  const arrayBuffer = await resultBlob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return 'data:image/jpeg;base64,' + btoa(binary);
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
