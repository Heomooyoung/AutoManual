const img = document.getElementById('photo');
const container = document.getElementById('container');
const zoomLabel = document.getElementById('zoomLabel');

let scale = 1, panX = 0, panY = 0;
let isDragging = false, dragStartX, dragStartY, startPanX, startPanY;

// 이미지 로드 (storage에서 읽기)
chrome.storage.local.get('_popupImage', (res) => {
  if (res._popupImage) {
    img.src = res._popupImage;
    chrome.storage.local.remove('_popupImage');
  }
});

function updateTransform() {
  img.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
  zoomLabel.textContent = Math.round(scale * 100) + '%';
}

// 휠 확대/축소
container.addEventListener('wheel', (e) => {
  e.preventDefault();
  const delta = e.deltaY > 0 ? -0.1 : 0.1;
  scale = Math.min(10, Math.max(0.1, scale + delta * scale));
  updateTransform();
});

// 드래그 이동
container.addEventListener('mousedown', (e) => {
  isDragging = true;
  container.classList.add('dragging');
  dragStartX = e.clientX; dragStartY = e.clientY;
  startPanX = panX; startPanY = panY;
});
window.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  panX = startPanX + (e.clientX - dragStartX);
  panY = startPanY + (e.clientY - dragStartY);
  updateTransform();
});
window.addEventListener('mouseup', () => {
  isDragging = false;
  container.classList.remove('dragging');
});

// 버튼
document.getElementById('zoomIn').addEventListener('click', () => {
  scale = Math.min(10, scale + 0.25);
  updateTransform();
});
document.getElementById('zoomOut').addEventListener('click', () => {
  scale = Math.max(0.1, scale - 0.25);
  updateTransform();
});
document.getElementById('resetBtn').addEventListener('click', () => {
  scale = 1; panX = 0; panY = 0;
  updateTransform();
});
document.getElementById('fitBtn').addEventListener('click', () => {
  scale = 1; panX = 0; panY = 0;
  updateTransform();
});

// 키보드
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.close();
  if (e.key === '+' || e.key === '=') { scale = Math.min(10, scale + 0.25); updateTransform(); }
  if (e.key === '-') { scale = Math.max(0.1, scale - 0.25); updateTransform(); }
  if (e.key === '0') { scale = 1; panX = 0; panY = 0; updateTransform(); }
});
