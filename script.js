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
let bassThreshold = 140;
let peakScale = 0;
let targetPeakScale = 0;
const shockwaves = [];
const flowNodes = [];
let lastFrame = 0;
let visualizerMode = 'central';

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
  initFlowField();
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
  freqData = new Uint8Array(analyser.frequencyBinCount);

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
  central: 'Central Shape (Integrated)',
  fluid: 'Full-Screen Fluid Swirl',
  off: 'Shape Mode Off'
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

setVisualizerMode('central');

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

function mirroredData(samples = 180) {
  if (!freqData) return [];
  const step = Math.max(1, Math.floor(freqData.length / samples));
  const half = [];
  for (let i = 0; i < samples; i++) {
    const idx = Math.min(freqData.length - 1, i * step);
    half.push(freqData[idx]);
  }
  return half.concat([...half].reverse());
}

function initFlowField(count = 420) {
  flowNodes.length = 0;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  for (let i = 0; i < count; i++) {
    flowNodes.push({
      x: (Math.random() - 0.5) * w,
      y: (Math.random() - 0.5) * h,
      angle: Math.random() * Math.PI * 2,
      speed: 40 + Math.random() * 60,
      hueShift: Math.random() * 180,
      history: []
    });
  }
}

function drawShockwaves(dt) {
  for (let i = shockwaves.length - 1; i >= 0; i--) {
    const s = shockwaves[i];
    s.age += dt;
    s.r += s.speed * dt;
    const fade = Math.max(0, 1 - s.age / s.duration);
    s.alpha = fade * 0.45;
    ctx.beginPath();
    ctx.arc(0, 0, s.r, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${s.color.r},${s.color.g},${s.color.b},${s.alpha})`;
    ctx.lineWidth = s.width;
    ctx.stroke();
    if (s.age >= s.duration) shockwaves.splice(i, 1);
  }
}

function spawnShockwave(baseRadius, hueBase) {
  const rgb = hsvToRgb((hueBase % 360) / 360, 0.7, 1);
  shockwaves.push({
    r: baseRadius,
    width: 5,
    speed: 280,
    age: 0,
    duration: 1.4,
    alpha: 0.45,
    color: rgb
  });
}

function hsvToRgb(h, s, v) {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const mod = i % 6;
  const r = [v, q, p, p, t, v][mod];
  const g = [t, v, v, q, p, p][mod];
  const b = [p, p, t, v, v, q][mod];
  return { r: Math.floor(r * 255), g: Math.floor(g * 255), b: Math.floor(b * 255) };
}

function updateFlowField(dt, energy, hueBase) {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const amp = Math.max(0.3, energy);
  const time = performance.now() * 0.0006;
  flowNodes.forEach(node => {
    const nx = (node.x / w) * 2;
    const ny = (node.y / h) * 2;
    const n1 = Math.sin(nx * 3 + time + node.hueShift * 0.02);
    const n2 = Math.cos(ny * 2.5 - time * 1.2 + node.hueShift * 0.015);
    const angle = n1 * 1.6 + n2 * 1.4 + amp * 2.5;
    node.angle = angle;
    const speed = node.speed * (0.6 + amp * 0.9);
    node.x += Math.cos(angle) * speed * dt;
    node.y += Math.sin(angle) * speed * dt;

    if (node.x > w / 2) node.x -= w;
    if (node.x < -w / 2) node.x += w;
    if (node.y > h / 2) node.y -= h;
    if (node.y < -h / 2) node.y += h;

    node.history.push({ x: node.x, y: node.y });
    if (node.history.length > 8) node.history.shift();
  });
}

function drawFlowField(hueBase, intensity) {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const trailAlpha = Math.min(0.9, 0.35 + intensity * 0.5);
  ctx.lineWidth = 1.4;
  flowNodes.forEach((node, idx) => {
    if (node.history.length < 2) return;
    const grad = ctx.createLinearGradient(node.history[0].x, node.history[0].y, node.x, node.y);
    const hue = (hueBase + node.hueShift) % 360;
    grad.addColorStop(0, `hsla(${hue}, 80%, 65%, ${trailAlpha})`);
    grad.addColorStop(1, `hsla(${(hue + 80) % 360}, 70%, 60%, ${trailAlpha})`);
    ctx.strokeStyle = grad;
    ctx.beginPath();
    const hist = node.history;
    ctx.moveTo(hist[0].x, hist[0].y);
    for (let i = 1; i < hist.length; i++) ctx.lineTo(hist[i].x, hist[i].y);
    ctx.stroke();
    if (idx % 8 === 0) {
      ctx.shadowBlur = 15;
      ctx.shadowColor = `hsla(${(hue + 40) % 360}, 90%, 70%, 0.4)`;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  });
}

function drawCentralCore(radiusBase, hueBase, data, energy) {
  const totalPoints = data.length;
  if (!totalPoints) return;
  const angleStep = (Math.PI * 2) / totalPoints;
  ctx.beginPath();
  for (let i = 0; i < totalPoints; i++) {
    const amp = data[i] / 255;
    const radius = radiusBase + amp * radiusBase * 0.35 + peakScale * 40;
    const angle = i * angleStep;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  const grad = ctx.createRadialGradient(0, 0, radiusBase * 0.25, 0, 0, radiusBase + 200);
  grad.addColorStop(0, `hsla(${(hueBase + 30) % 360}, 85%, 68%, 0.85)`);
  grad.addColorStop(0.55, `hsla(${(hueBase + 160) % 360}, 75%, 60%, 0.55)`);
  grad.addColorStop(1, 'rgba(5,6,11,0.6)');
  ctx.fillStyle = grad;
  ctx.shadowBlur = 18;
  ctx.shadowColor = `hsla(${(hueBase + 40) % 360}, 85%, 65%, 0.5)`;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = `hsla(${(hueBase + 120) % 360}, 80%, 70%, 0.9)`;
  ctx.stroke();

  ctx.globalAlpha = 0.3 + energy * 0.4;
  ctx.beginPath();
  ctx.arc(0, 0, radiusBase * 0.6, 0, Math.PI * 2);
  ctx.fillStyle = `hsla(${(hueBase + 80) % 360}, 90%, 60%, 0.4)`;
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawFluidBackdrop(w, h, hueBase, energy) {
  const grad = ctx.createRadialGradient(0, 0, Math.min(w, h) * 0.05, 0, 0, Math.min(w, h) * 0.8);
  grad.addColorStop(0, `rgba(10, 12, 20, 0.4)`);
  grad.addColorStop(0.4, `hsla(${(hueBase + 30) % 360}, 80%, 18%, 0.25)`);
  grad.addColorStop(1, `rgba(5, 6, 11, 0.9)`);
  ctx.fillStyle = grad;
  ctx.fillRect(-w / 2, -h / 2, w, h);

  const overlay = ctx.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
  overlay.addColorStop(0, `hsla(${(hueBase + 200) % 360}, 70%, 30%, 0.12)`);
  overlay.addColorStop(1, `hsla(${(hueBase + 320) % 360}, 70%, 30%, 0.12)`);
  ctx.fillStyle = overlay;
  ctx.globalAlpha = 0.9;
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.globalAlpha = 1;

  ctx.globalAlpha = 0.12 + energy * 0.08;
  ctx.fillStyle = `hsla(${(hueBase + 90) % 360}, 90%, 65%, 0.35)`;
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.globalAlpha = 1;
}

function drawVisualizer(timestamp = 0) {
  requestAnimationFrame(drawVisualizer);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.translate(w / 2, h / 2);

  const dt = lastFrame ? (timestamp - lastFrame) / 1000 : 0;
  lastFrame = timestamp;

  if (!analyser || !freqData) {
    ctx.restore();
    return;
  }

  analyser.getByteFrequencyData(freqData);
  const time = performance.now();
  const bassBins = freqData.slice(0, 22);
  const midBins = freqData.slice(22, 90);
  const trebleBins = freqData.slice(90, 180);
  const bassEnergy = bassBins.reduce((a, b) => a + b, 0) / bassBins.length;
  const midEnergy = midBins.reduce((a, b) => a + b, 0) / Math.max(1, midBins.length);
  const trebleEnergy = trebleBins.reduce((a, b) => a + b, 0) / Math.max(1, trebleBins.length);
  const overallEnergy = (bassEnergy + midEnergy + trebleEnergy) / 3 / 255;
  const beatTriggered = bassEnergy > bassThreshold;

  if (beatTriggered) {
    targetPeakScale = Math.min(1.5, targetPeakScale + (bassEnergy / 255) * 0.5);
    bassThreshold = bassThreshold * 0.7 + bassEnergy * 0.3;
    spawnShockwave(Math.min(w, h) * 0.12, (time * 0.04) % 360);
  } else {
    bassThreshold = bassThreshold * 0.995 + bassEnergy * 0.005;
  }

  targetPeakScale *= 0.9;
  peakScale = peakScale * 0.86 + targetPeakScale * 0.14;

  const hueBase = (time * 0.03) % 360;
  drawFluidBackdrop(w, h, hueBase, overallEnergy);

  updateFlowField(dt || 0.016, overallEnergy + peakScale * 0.4, hueBase);
  drawFlowField(hueBase, overallEnergy + peakScale * 0.4);

  const data = mirroredData(220);
  const radiusBase = Math.min(w, h) * 0.22 + peakScale * 20;

  if (visualizerMode === 'central') {
    drawCentralCore(radiusBase, hueBase, data, overallEnergy);
  } else if (visualizerMode === 'fluid') {
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = `hsla(${(hueBase + 40) % 360}, 80%, 60%, 0.15)`;
    for (let i = 0; i < 8; i++) {
      ctx.beginPath();
      const r = radiusBase * (0.6 + i * 0.12) + peakScale * 30;
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  drawShockwaves(dt || 0.016);
  ctx.restore();
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
