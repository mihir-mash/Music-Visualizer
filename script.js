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
const shapeSelect = document.getElementById('shapeSelect');
const shapeLabel = document.getElementById('shapeLabel');
const playlistSearch = document.getElementById('playlistSearch');
const tabButtons = document.querySelectorAll('.tab-btn');
const tabPanels = document.querySelectorAll('.tab-panel');

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
const ringPoints = 140;
let bassThreshold = 140;
let peakScale = 0;
let targetPeakScale = 0;
const shockwaves = [];
const particles = [];
let lastFrame = 0;
let currentShape = 'circle';

const eqPoints = [
  { freq: 60, gain: 0 },
  { freq: 230, gain: 0 },
  { freq: 910, gain: 0 },
  { freq: 3600, gain: 0 },
  { freq: 14000, gain: 0 }
];
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
  freqData = new Uint8Array(analyser.frequencyBinCount);

  const bands = eqPoints.map(p => ({ freq: p.freq }));
  eqFilters = bands.map((band, i) => {
    const node = audioContext.createBiquadFilter();
    if (i === 0) node.type = 'lowshelf';
    else if (i === bands.length - 1) node.type = 'highshelf';
    else node.type = 'peaking';
    node.frequency.value = band.freq;
    node.Q.value = 1;
    node.gain.value = eqPoints[i].gain;
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

shapeSelect.addEventListener('change', (e) => {
  currentShape = e.target.value;
  shapeLabel.textContent = shapeSelect.options[shapeSelect.selectedIndex].text;
});

// EQ canvas interaction
function layoutEqPoints() {
  const w = eqCanvas.clientWidth;
  const h = eqCanvas.clientHeight;
  if (!w || !h) return;
  const margin = 24;
  eqPoints.forEach((p, i) => {
    const x = margin + (i / (eqPoints.length - 1)) * (w - margin * 2);
    const centerY = h / 2;
    const range = h * 0.35;
    const y = centerY - (p.gain / maxGain) * range;
    p.x = x;
    p.y = y;
  });
}

function drawEq() {
  const w = eqCanvas.clientWidth;
  const h = eqCanvas.clientHeight;
  if (!w || !h) return;
  eqCtx.clearRect(0, 0, w, h);
  const gridGrad = eqCtx.createLinearGradient(0, 0, 0, h);
  gridGrad.addColorStop(0, 'rgba(91,192,255,0.08)');
  gridGrad.addColorStop(0.5, 'rgba(255,255,255,0.06)');
  gridGrad.addColorStop(1, 'rgba(247,163,90,0.08)');
  eqCtx.fillStyle = gridGrad;
  eqCtx.fillRect(0, 0, w, h);

  eqCtx.strokeStyle = 'rgba(255,255,255,0.08)';
  eqCtx.lineWidth = 1;
  const mid = h / 2;
  for (let i = 0; i <= 4; i++) {
    const y = (i / 4) * h;
    eqCtx.beginPath();
    eqCtx.moveTo(0, y);
    eqCtx.lineTo(w, y);
    eqCtx.stroke();
  }
  eqCtx.beginPath();
  eqCtx.moveTo(0, mid);
  eqCtx.lineTo(w, mid);
  eqCtx.strokeStyle = 'rgba(255,255,255,0.15)';
  eqCtx.stroke();

  // Curve
  eqCtx.lineWidth = 3;
  const gradient = eqCtx.createLinearGradient(0, 0, w, 0);
  gradient.addColorStop(0, '#5bc0ff');
  gradient.addColorStop(0.5, '#9c7bff');
  gradient.addColorStop(1, '#f7a35a');
  eqCtx.strokeStyle = gradient;
  eqCtx.shadowBlur = 10;
  eqCtx.shadowColor = 'rgba(91,192,255,0.35)';

  eqCtx.beginPath();
  eqPoints.forEach((p, i) => {
    if (i === 0) eqCtx.moveTo(p.x, p.y);
    else eqCtx.lineTo(p.x, p.y);
  });
  eqCtx.stroke();
  eqCtx.shadowBlur = 0;

  // Points
  eqPoints.forEach(p => {
    eqCtx.fillStyle = '#0f1320';
    eqCtx.strokeStyle = '#5bc0ff';
    eqCtx.lineWidth = 2;
    eqCtx.beginPath();
    eqCtx.arc(p.x, p.y, 7, 0, Math.PI * 2);
    eqCtx.fill();
    eqCtx.stroke();
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

function mirroredData(samples = ringPoints) {
  if (!freqData) return [];
  const step = Math.max(1, Math.floor(freqData.length / samples));
  const half = [];
  for (let i = 0; i < samples; i++) {
    const idx = Math.min(freqData.length - 1, i * step);
    half.push(freqData[idx]);
  }
  const mirrored = half.concat([...half].reverse());
  return mirrored;
}

function drawShockwaves(dt) {
  for (let i = shockwaves.length - 1; i >= 0; i--) {
    const s = shockwaves[i];
    s.age += dt;
    s.r += s.speed * dt;
    const fade = Math.max(0, 1 - s.age / s.duration);
    s.alpha = fade * 0.6;
    ctx.beginPath();
    ctx.arc(0, 0, s.r, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255,255,255,${s.alpha})`;
    ctx.lineWidth = s.width;
    ctx.stroke();
    if (s.age >= s.duration) shockwaves.splice(i, 1);
  }
}

function drawStardust(dt, hueBase) {
  particles.forEach(p => {
    p.age += dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    const lifeRatio = Math.max(0, 1 - p.age / p.life);
    ctx.fillStyle = `hsla(${(hueBase + p.hueShift) % 360}, 75%, 68%, ${lifeRatio * 0.9})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  });
  for (let i = particles.length - 1; i >= 0; i--) if (particles[i].age >= particles[i].life) particles.splice(i, 1);
}

function spawnShockwave(baseRadius) {
  shockwaves.push({
    r: baseRadius,
    width: 6,
    speed: 260,
    age: 0,
    duration: 1.6,
    alpha: 0.6
  });
}

function spawnStardust(count) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 120 + Math.random() * 140;
    particles.push({
      x: 0,
      y: 0,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: 1 + Math.random() * 1.8,
      hueShift: Math.random() * 180,
      age: 0,
      life: 2.4 + Math.random() * 1.1
    });
  }
}

function drawCircleShape(radiusBase, ampScale, hueBase, time) {
  const data = mirroredData(ringPoints);
  const totalPoints = data.length;
  const angleStep = (Math.PI * 2) / totalPoints;
  ctx.beginPath();
  for (let i = 0; i < totalPoints; i++) {
    const amp = data[i] / 255;
    const radius = radiusBase + amp * ampScale + peakScale * 50;
    const angle = i * angleStep + time * 0.0006;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  const grad = ctx.createRadialGradient(0, 0, radiusBase * 0.2, 0, 0, radiusBase + 180);
  grad.addColorStop(0, `hsla(${(hueBase + 30) % 360}, 80%, 60%, 0.7)`);
  grad.addColorStop(0.6, `hsla(${(hueBase + 170) % 360}, 70%, 58%, 0.4)`);
  grad.addColorStop(1, 'rgba(14,16,24,0.35)');
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = `hsla(${(hueBase + 120) % 360}, 70%, 68%, 0.85)`;
  ctx.stroke();
}

function drawWaveShape(w, h, hueBase) {
  const samples = 120;
  const data = mirroredData(samples);
  const midY = 0;
  const amplitude = Math.min(w, h) * 0.18;
  ctx.beginPath();
  for (let i = 0; i < data.length; i++) {
    const t = i / (data.length - 1);
    const x = (t - 0.5) * w;
    const ease = Math.sin(Math.PI * t);
    const y = midY - (data[i] / 255) * amplitude * ease - peakScale * 35 * ease;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  const grad = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
  grad.addColorStop(0, `hsla(${(hueBase + 40) % 360}, 75%, 64%, 0.45)`);
  grad.addColorStop(1, `hsla(${(hueBase + 200) % 360}, 75%, 64%, 0.45)`);
  ctx.strokeStyle = grad;
  ctx.lineWidth = 4;
  ctx.stroke();

  const fillGrad = ctx.createLinearGradient(0, -amplitude - 60, 0, amplitude + 80);
  fillGrad.addColorStop(0, `hsla(${(hueBase + 10) % 360}, 85%, 65%, 0.25)`);
  fillGrad.addColorStop(1, 'rgba(12,15,24,0.55)');
  ctx.lineTo(w / 2, h / 2);
  ctx.lineTo(-w / 2, h / 2);
  ctx.closePath();
  ctx.fillStyle = fillGrad;
  ctx.fill();
}

function drawHexShape(radiusBase, ampScale, hueBase, time) {
  const sides = 6;
  const data = mirroredData(sides);
  const angleStep = (Math.PI * 2) / sides;
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const amp = data[i] / 255;
    const radius = radiusBase + amp * ampScale + peakScale * 40;
    const angle = i * angleStep + time * 0.0004;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  const grad = ctx.createRadialGradient(0, 0, radiusBase * 0.1, 0, 0, radiusBase + 140);
  grad.addColorStop(0, `hsla(${(hueBase + 10) % 360}, 80%, 60%, 0.7)`);
  grad.addColorStop(0.6, `hsla(${(hueBase + 150) % 360}, 70%, 60%, 0.5)`);
  grad.addColorStop(1, 'rgba(14,16,24,0.35)');
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = `hsla(${(hueBase + 110) % 360}, 70%, 70%, 0.9)`;
  ctx.stroke();
}

function drawVisualizer(timestamp = 0) {
  requestAnimationFrame(drawVisualizer);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.shadowBlur = 15;
  ctx.shadowColor = 'rgba(91,192,255,0.55)';

  const dt = lastFrame ? (timestamp - lastFrame) / 1000 : 0;
  lastFrame = timestamp;

  if (!analyser || !freqData) {
    ctx.restore();
    return;
  }

  analyser.getByteFrequencyData(freqData);
  const time = performance.now();
  const bassBins = freqData.slice(0, 18);
  const bassEnergy = bassBins.reduce((a, b) => a + b, 0) / bassBins.length;
  const beatTriggered = bassEnergy > bassThreshold;

  if (beatTriggered) {
    targetPeakScale = Math.min(1.6, targetPeakScale + (bassEnergy / 255) * 0.6);
    bassThreshold = bassThreshold * 0.7 + bassEnergy * 0.3;
    spawnShockwave(Math.min(w, h) * 0.1);
    spawnStardust(16);
  } else {
    bassThreshold = bassThreshold * 0.995 + bassEnergy * 0.005;
  }

  targetPeakScale *= 0.9;
  peakScale = peakScale * 0.86 + targetPeakScale * 0.14;

  const radiusBase = Math.min(w, h) * 0.25;
  const hueBase = (time * 0.03) % 360;
  const ampScale = Math.min(w, h) * 0.16;

  switch (currentShape) {
    case 'wave':
      drawWaveShape(w, h, hueBase);
      break;
    case 'hex':
      drawHexShape(radiusBase, ampScale * 0.6, hueBase, time);
      break;
    default:
      drawCircleShape(radiusBase, ampScale, hueBase, time);
      break;
  }

  drawShockwaves(dt || 0.016);
  drawStardust(dt || 0.016, hueBase);

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
