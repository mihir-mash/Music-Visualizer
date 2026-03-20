const folderInput = document.getElementById('folderInput');
const playlistEl = document.getElementById('playlist');
const playBtn = document.getElementById('playBtn');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const shuffleBtn = document.getElementById('shuffleBtn');
const repeatBtn = document.getElementById('repeatBtn');
const progressEl = document.getElementById('progress');
const currentTimeEl = document.getElementById('currentTime');
const durationEl = document.getElementById('duration');
const resetEqBtn = document.getElementById('resetEq');
const eqCanvas = document.getElementById('eqCanvas');
const eqCtx = eqCanvas.getContext('2d');
const canvas = document.getElementById('visualizer');
const ctx = canvas.getContext('2d');
const playlistSearch = document.getElementById('playlistSearch');
const tabButtons = document.querySelectorAll('.tab-btn');
const tabPanels = document.querySelectorAll('.tab-panel');
const vizTrigger = document.getElementById('vizTrigger');
const vizMenu = document.getElementById('vizMenu');
const vizMenuList = document.getElementById('vizMenuList');
const shapeLabel = document.getElementById('shapeLabel');
const speedSlider = document.getElementById('speedSlider');
const speedValue = document.getElementById('speedValue');

let audio = new Audio();
let audioContext = null;
let sourceNode = null;
let analyser = null;
let eqFilters = [];
let gainNode = null;
let panner = null;

let playlist = [];
let currentIndex = 0;
let isPlaying = false;
let isShuffle = false;
let isRepeat = false;
let shuffleQueue = [];
let shufflePos = 0;

let freqData = null;
let timeData = null;
let visualizerMode = 'flow';
let bassSmoothed = 0;
let beatBoost = 0;

const waveLayers = [
  { hue: 205, offset: -26 },
  { hue: 255, offset: 0 },
  { hue: 290, offset: 26 }
];

const eqPoints = [31, 63, 125, 250, 500, 750, 1000, 1500, 2000, 3000, 4000, 6000, 8000, 10000, 12000, 16000]
  .map(freq => ({ freq, gain: 0, label: freq >= 1000 ? `${(freq / 1000).toFixed(freq >= 10000 ? 0 : 1)}k` : `${freq}` }));
let dragging = null;
const maxGain = 15;

function setIcon(btn, name, active = false) {
  const icons = {
    prev: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="19 20 9 12 19 4 19 20"></polygon><line x1="5" y1="19" x2="5" y2="5"></line></svg>',
    next: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 4 15 12 5 20 5 4"></polygon><line x1="19" y1="5" x2="19" y2="19"></line></svg>',
    play: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>',
    pause: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>',
    shuffle: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 3 21 3 21 8"></polyline><line x1="4" y1="20" x2="21" y2="3"></line><polyline points="21 16 21 21 16 21"></polyline><line x1="15" y1="15" x2="21" y2="21"></line><line x1="4" y1="4" x2="9" y2="9"></line></svg>',
    repeat: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"></polyline><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><polyline points="7 23 3 19 7 15"></polyline><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg>'
  };
  btn.innerHTML = icons[name];
  btn.classList.toggle('active', active);
}

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = canvas.clientWidth * dpr;
  canvas.height = canvas.clientHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function resizeEqCanvas() {
  const dpr = window.devicePixelRatio || 1;
  eqCanvas.width = eqCanvas.clientWidth * dpr;
  eqCanvas.height = eqCanvas.clientHeight * dpr;
  eqCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  layoutEqPoints();
  drawEq();
}

window.addEventListener('resize', () => {
  resizeCanvas();
  resizeEqCanvas();
});

resizeCanvas();
resizeEqCanvas();

function setActiveTab(name) {
  tabButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.tab === name));
  tabPanels.forEach(panel => panel.classList.toggle('active', panel.dataset.name === name));
  if (name === 'visualizer') resizeCanvas();
  if (name === 'controls') resizeEqCanvas();
}

tabButtons.forEach(btn => {
  btn.addEventListener('click', () => setActiveTab(btn.dataset.tab));
});

function formatTime(sec) {
  if (!sec || isNaN(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function createAudioGraph() {
  if (audioContext) return;
  audioContext = new (window.AudioContext || window.webkitAudioContext)();
  sourceNode = audioContext.createMediaElementSource(audio);
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.7;
  freqData = new Uint8Array(analyser.frequencyBinCount);
  timeData = new Uint8Array(analyser.fftSize);

  eqFilters = eqPoints.map((band, i) => {
    const node = audioContext.createBiquadFilter();
    if (i === 0) node.type = 'lowshelf';
    else if (i === eqPoints.length - 1) node.type = 'highshelf';
    else node.type = 'peaking';
    node.frequency.value = band.freq;
    node.Q.value = 1.1;
    node.gain.value = band.gain;
    return node;
  });

  gainNode = audioContext.createGain();
  gainNode.gain.value = 1;

  panner = audioContext.createStereoPanner();
  panner.pan.value = 0;

  const chain = [sourceNode, ...eqFilters, gainNode, panner, analyser, audioContext.destination];
  for (let i = 0; i < chain.length - 1; i++) chain[i].connect(chain[i + 1]);
}

function renderPlaylist() {
  playlistEl.innerHTML = '';
  playlist.forEach((track, idx) => {
    const div = document.createElement('div');
    div.className = 'track' + (idx === currentIndex ? ' active' : '');
    div.textContent = track.name;
    div.addEventListener('click', () => {
      currentIndex = idx;
      if (isShuffle) rebuildShuffleQueue(currentIndex);
      playCurrent();
    });
    playlistEl.appendChild(div);
  });
}

function highlightCurrent() {
  [...playlistEl.children].forEach((el, i) => {
    el.classList.toggle('active', i === currentIndex);
  });
}

function loadPlaylist(files) {
  try {
    playlist = Array.from(files)
      .filter(f => f.type === 'audio/mpeg' || f.name.toLowerCase().endsWith('.mp3'))
      .map(f => ({ file: f, name: f.name.replace(/\.[^.]+$/, ''), url: URL.createObjectURL(f) }));
    if (!playlist.length) return;
    currentIndex = 0;
    renderPlaylist();
    if (isShuffle) rebuildShuffleQueue(currentIndex);
    loadTrack(currentIndex);
  } catch (err) {
    console.error('Error loading files', err);
  }
}

function loadTrack(index) {
  const track = playlist[index];
  if (!track) return;
  audio.src = track.url;
  audio.load();
  highlightCurrent();
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function rebuildShuffleQueue(excludeIndex) {
  const indices = playlist.map((_, i) => i).filter(i => i !== excludeIndex);
  shuffleQueue = shuffleArray(indices);
  shufflePos = 0;
}

function playCurrent() {
  if (!playlist.length) return;
  createAudioGraph();
  if (audioContext.state === 'suspended') audioContext.resume();
  loadTrack(currentIndex);
  audio.play().then(() => {
    isPlaying = true;
    setIcon(playBtn, 'pause');
  }).catch(err => console.error('Playback error', err));
}

function pausePlayback() {
  audio.pause();
  isPlaying = false;
  setIcon(playBtn, 'play');
}

function nextIndexFromShuffle() {
  if (!shuffleQueue.length || shufflePos >= shuffleQueue.length) rebuildShuffleQueue(currentIndex);
  const idx = shuffleQueue[shufflePos];
  shufflePos += 1;
  return idx !== undefined ? idx : currentIndex;
}

function nextTrack() {
  if (!playlist.length) return;
  currentIndex = isShuffle ? nextIndexFromShuffle() : (currentIndex + 1) % playlist.length;
  playCurrent();
}

function prevTrack() {
  if (!playlist.length) return;
  if (isShuffle && shufflePos > 1) {
    shufflePos = Math.max(1, shufflePos - 1);
    currentIndex = shuffleQueue[shufflePos - 1] ?? currentIndex;
  } else {
    currentIndex = (currentIndex - 1 + playlist.length) % playlist.length;
  }
  playCurrent();
}

function handleEnded() {
  if (isRepeat) playCurrent();
  else nextTrack();
}

function updateProgress() {
  const { currentTime, duration } = audio;
  progressEl.max = duration || 0;
  progressEl.value = currentTime;
  currentTimeEl.textContent = formatTime(currentTime);
  durationEl.textContent = formatTime(duration);
}

progressEl.addEventListener('input', () => {
  if (audio.duration) audio.currentTime = progressEl.value;
});

function updatePlaybackSpeed(value) {
  const rate = Math.max(0.5, Math.min(2, value));
  audio.playbackRate = rate;
  if (speedValue) speedValue.textContent = `${rate.toFixed(2)}x`;
}

if (speedSlider) {
  speedSlider.addEventListener('input', () => {
    updatePlaybackSpeed(parseFloat(speedSlider.value));
  });
  updatePlaybackSpeed(parseFloat(speedSlider.value) || 1);
}

playBtn.addEventListener('click', () => {
  if (!playlist.length) return;
  if (!isPlaying) playCurrent(); else pausePlayback();
});

prevBtn.addEventListener('click', prevTrack);
nextBtn.addEventListener('click', nextTrack);

shuffleBtn.addEventListener('click', () => {
  isShuffle = !isShuffle;
  shuffleBtn.classList.toggle('active', isShuffle);
  if (isShuffle) rebuildShuffleQueue(currentIndex);
});

repeatBtn.addEventListener('click', () => {
  isRepeat = !isRepeat;
  repeatBtn.classList.toggle('active', isRepeat);
});

folderInput.addEventListener('change', e => loadPlaylist(e.target.files));
audio.addEventListener('timeupdate', updateProgress);
audio.addEventListener('ended', handleEnded);

playlistSearch.addEventListener('input', () => {
  const term = playlistSearch.value.trim().toLowerCase();
  [...playlistEl.children].forEach(item => {
    const match = item.textContent.toLowerCase().includes(term);
    item.style.display = match ? 'block' : 'none';
  });
});

const vizLabels = {
  flow: 'Generative Flowing Art',
  waveform: 'Beat-Synced Waveform',
  orb: 'Drum-Reactive Orb'
};

function setVisualizerMode(mode) {
  visualizerMode = mode;
  shapeLabel.textContent = vizLabels[mode] || mode;
  vizMenu.classList.remove('open');
}

vizTrigger.addEventListener('click', () => {
  vizMenu.classList.toggle('open');
});

vizMenuList.addEventListener('click', (e) => {
  const btn = e.target.closest('.dropdown-item');
  if (!btn) return;
  const mode = btn.dataset.mode;
  setVisualizerMode(mode);
});

document.addEventListener('click', (e) => {
  if (!vizMenu.contains(e.target)) vizMenu.classList.remove('open');
});

setVisualizerMode('flow');

// EQ canvas interaction
function layoutEqPoints() {
  const w = eqCanvas.clientWidth;
  const h = eqCanvas.clientHeight;
  if (!w || !h) return;
  const marginX = 28;
  const marginTop = 18;
  const marginBottom = 30;
  eqPoints.forEach((p, i) => {
    const x = marginX + (i / (eqPoints.length - 1)) * (w - marginX * 2);
    const centerY = (h - marginBottom + marginTop) / 2;
    const range = (h - marginTop - marginBottom) / 2;
    const y = centerY - (p.gain / maxGain) * range;
    p.x = x;
    p.y = y;
  });
}

function drawSmoothCurve(points) {
  if (!points.length) return;
  eqCtx.beginPath();
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1] || points[i];
    const p3 = points[i + 2] || p2;
    for (let t = 0; t <= 1; t += 0.08) {
      const tt = t * t;
      const ttt = tt * t;
      const x = 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * tt + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * ttt);
      const y = 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * tt + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * ttt);
      if (i === 0 && t === 0) eqCtx.moveTo(x, y); else eqCtx.lineTo(x, y);
    }
  }
}

function drawEq() {
  const w = eqCanvas.clientWidth;
  const h = eqCanvas.clientHeight;
  if (!w || !h) return;
  eqCtx.clearRect(0, 0, w, h);

  const gridGrad = eqCtx.createLinearGradient(0, 0, 0, h);
  gridGrad.addColorStop(0, 'rgba(103,212,255,0.08)');
  gridGrad.addColorStop(0.5, 'rgba(255,255,255,0.05)');
  gridGrad.addColorStop(1, 'rgba(216,115,255,0.08)');
  eqCtx.fillStyle = gridGrad;
  eqCtx.fillRect(0, 0, w, h);

  eqCtx.strokeStyle = 'rgba(255,255,255,0.08)';
  eqCtx.lineWidth = 1;
  const mid = h / 2;
  for (let i = 0; i <= 5; i++) {
    const y = (i / 5) * h;
    eqCtx.beginPath();
    eqCtx.moveTo(0, y);
    eqCtx.lineTo(w, y);
    eqCtx.stroke();
  }
  eqCtx.beginPath();
  eqCtx.moveTo(0, mid);
  eqCtx.lineTo(w, mid);
  eqCtx.strokeStyle = 'rgba(255,255,255,0.16)';
  eqCtx.stroke();

  eqCtx.lineWidth = 3.5;
  const gradient = eqCtx.createLinearGradient(0, 0, w, 0);
  gradient.addColorStop(0, '#67d4ff');
  gradient.addColorStop(0.5, '#d873ff');
  gradient.addColorStop(1, '#ffd166');
  eqCtx.strokeStyle = gradient;
  eqCtx.shadowBlur = 14;
  eqCtx.shadowColor = 'rgba(103,212,255,0.45)';
  drawSmoothCurve(eqPoints);
  eqCtx.stroke();
  eqCtx.shadowBlur = 0;

  eqPoints.forEach(p => {
    eqCtx.fillStyle = '#0b0f1a';
    eqCtx.strokeStyle = 'rgba(103,212,255,0.9)';
    eqCtx.lineWidth = 2;
    eqCtx.beginPath();
    eqCtx.arc(p.x, p.y, 7, 0, Math.PI * 2);
    eqCtx.fill();
    eqCtx.stroke();
  });

  eqCtx.fillStyle = 'rgba(255,255,255,0.65)';
  eqCtx.font = '11px "Space Grotesk", "Inter", sans-serif';
  eqCtx.textAlign = 'center';
  eqPoints.forEach(p => {
    eqCtx.fillText(p.label, p.x, h - 10);
  });
}

function pointFromEvent(e) {
  const rect = eqCanvas.getBoundingClientRect();
  const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
  const y = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
  return { x, y };
}

function pickPoint(pos) {
  return eqPoints.find(p => Math.hypot(p.x - pos.x, p.y - pos.y) < 12);
}

function updatePointGain(p, y) {
  const h = eqCanvas.clientHeight;
  const centerY = h / 2;
  const range = h * 0.35;
  const clampedY = Math.max(centerY - range, Math.min(centerY + range, y));
  p.y = clampedY;
  p.gain = ((centerY - clampedY) / range) * maxGain;
  applyEqGains();
  drawEq();
}

function applyEqGains() {
  if (!eqFilters.length) return;
  eqPoints.forEach((p, i) => {
    eqFilters[i].gain.value = p.gain;
  });
}

eqCanvas.addEventListener('mousedown', startDrag);
eqCanvas.addEventListener('touchstart', startDrag, { passive: false });
function startDrag(e) {
  e.preventDefault();
  const pos = pointFromEvent(e);
  const picked = pickPoint(pos);
  if (picked) dragging = picked;
}

window.addEventListener('mousemove', dragMove);
window.addEventListener('touchmove', dragMove, { passive: false });
function dragMove(e) {
  if (!dragging) return;
  e.preventDefault();
  const pos = pointFromEvent(e);
  updatePointGain(dragging, pos.y);
}

window.addEventListener('mouseup', endDrag);
window.addEventListener('touchend', endDrag);
function endDrag() {
  dragging = null;
}

resetEqBtn.addEventListener('click', () => {
  eqPoints.forEach(p => { p.gain = 0; });
  layoutEqPoints();
  applyEqGains();
  drawEq();
});

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function drawBackgroundGrid() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const spacing = Math.max(42, Math.min(w, h) / 18);
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= w; x += spacing) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y <= h; y += spacing) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawGenerativeFlow(time) {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const cx = w / 2;
  const cy = h / 2;
  const t = time * 0.0012;
  const layers = 4;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.globalCompositeOperation = 'lighter';

  for (let l = 0; l < layers; l++) {
    const phase = t * (0.4 + l * 0.08) + l * Math.PI * 0.5;
    const amp = Math.min(w, h) * (0.18 + l * 0.03);
    const points = [];
    const steps = 80;
    for (let i = 0; i <= steps; i++) {
      const p = i / steps;
      const angle = p * Math.PI * 2;
      const r = amp * (0.7 + 0.25 * Math.sin(angle * 3 + phase) + 0.15 * Math.cos(angle * 2.2 - phase * 0.7));
      const x = Math.cos(angle) * r * (1 + 0.05 * Math.sin(phase + p * 6.28));
      const y = Math.sin(angle) * r * (1 + 0.05 * Math.cos(phase - p * 5.12));
      points.push({ x, y });
    }
    const hue = 190 + l * 32;
    const grad = ctx.createLinearGradient(-amp, 0, amp, 0);
    grad.addColorStop(0, `hsla(${hue}, 85%, 68%, 0.55)`);
    grad.addColorStop(0.5, `hsla(${hue + 40}, 95%, 72%, 0.8)`);
    grad.addColorStop(1, `hsla(${hue + 80}, 90%, 70%, 0.55)`);

    ctx.lineWidth = 1.8 + l * 0.6;
    ctx.strokeStyle = grad;
    ctx.shadowBlur = 22 + l * 4;
    ctx.shadowColor = `hsla(${hue + 30}, 100%, 72%, 0.65)`;

    drawSmoothPath(points);
    ctx.stroke();
  }

  ctx.restore();
}

function drawSmoothPath(points) {
  if (!points.length) return;
  ctx.beginPath();
  for (let i = 0; i < points.length; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1] || p1;
    const midX = (p1.x + p2.x) / 2;
    const midY = (p1.y + p2.y) / 2;
    if (i === 0) ctx.moveTo(p1.x, p1.y);
    else ctx.quadraticCurveTo(p1.x, p1.y, midX, midY);
  }
}

function drawGlowingWaveform() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const baseAmp = Math.min(h * 0.2, 120);
  const amp = baseAmp * (0.5 + bassSmoothed * 0.6);
  const boost = 1 + beatBoost * 1.8;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const segments = Math.min(160, timeData ? Math.floor(timeData.length / 4) : 120);

  waveLayers.forEach((layer, idx) => {
    const points = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const x = t * w;
      const sampleIdx = timeData ? Math.floor(t * (timeData.length - 1)) : 0;
      const osc = timeData ? ((timeData[sampleIdx] - 128) / 128) : 0;
      const localAmp = amp * (0.65 + idx * 0.04) * boost;
      const y = osc * localAmp + layer.offset;
      points.push({ x, y: h / 2 + y });
    }

    const grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, `hsla(${layer.hue}, 90%, 70%, 0.85)`);
    grad.addColorStop(0.5, `hsla(${layer.hue + 40}, 90%, 66%, 0.95)`);
    grad.addColorStop(1, `hsla(${layer.hue + 80}, 85%, 72%, 0.85)`);

    ctx.lineWidth = 2.4 + idx * 0.6;
    ctx.strokeStyle = grad;
    ctx.shadowBlur = 24 + idx * 4;
    ctx.shadowColor = `hsla(${layer.hue + 30}, 100%, 70%, 0.9)`;
    drawSmoothPath(points);
    ctx.stroke();
  });

  ctx.restore();
}

function drawBeatingOrb() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const base = Math.min(w, h) * 0.12;
  const rim = base * (0.9 + bassSmoothed * 1.5 + beatBoost * 1.2);
  const detail = freqData ? freqData.length : 0;
  const steps = 140;

  ctx.save();
  ctx.translate(w / 2, h / 2);

  const grad = ctx.createRadialGradient(0, 0, rim * 0.25, 0, 0, rim + base * 0.25);
  grad.addColorStop(0, 'rgba(140, 233, 255, 0.95)');
  grad.addColorStop(0.55, 'rgba(115, 156, 255, 0.75)');
  grad.addColorStop(1, 'rgba(6, 8, 14, 0.15)');

  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const angle = t * Math.PI * 2;
    const sample = detail ? freqData[Math.floor(t * (detail - 1))] / 255 : 0;
    const push = sample * base * 0.18;
    const r = rim + push;
    const x = Math.cos(angle) * r;
    const y = Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();

  ctx.fillStyle = grad;
  ctx.shadowBlur = 40;
  ctx.shadowColor = 'rgba(103, 212, 255, 0.9)';
  ctx.fill();

  ctx.shadowBlur = 24;
  ctx.strokeStyle = 'rgba(103, 212, 255, 0.7)';
  ctx.lineWidth = 2.4;
  ctx.stroke();

  ctx.restore();
}

function drawVisualizer() {
  requestAnimationFrame(drawVisualizer);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  ctx.clearRect(0, 0, w, h);

  if (!analyser || !freqData) {
    drawBackgroundGrid();
    return;
  }

  analyser.getByteFrequencyData(freqData);
  if (timeData) analyser.getByteTimeDomainData(timeData);
  const time = performance.now();
  const bassBins = freqData.slice(0, 24);
  const bassEnergy = bassBins.reduce((a, b) => a + b, 0) / Math.max(1, bassBins.length);
  const bassNorm = bassEnergy / 255;
  bassSmoothed = lerp(bassSmoothed, bassNorm, 0.12);
  const threshold = 0.38;
  if (bassNorm > threshold) {
    beatBoost = Math.min(1, beatBoost + (bassNorm - threshold) * 2.2);
  } else {
    beatBoost = lerp(beatBoost, 0, 0.12);
  }

  if (visualizerMode === 'flow') {
    drawBackgroundGrid();
    drawGenerativeFlow(time);
  } else if (visualizerMode === 'waveform') {
    drawBackgroundGrid();
    drawGlowingWaveform();
  } else if (visualizerMode === 'orb') {
    drawBackgroundGrid();
    drawBeatingOrb();
  }
}

drawVisualizer();

function initIcons() {
  setIcon(prevBtn, 'prev');
  setIcon(nextBtn, 'next');
  setIcon(playBtn, 'play');
  setIcon(shuffleBtn, 'shuffle');
  setIcon(repeatBtn, 'repeat');
}

initIcons();

setActiveTab('visualizer');

// Initial layout
layoutEqPoints();
drawEq();

// Keyboard space to play/pause
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); playBtn.click(); }
});
