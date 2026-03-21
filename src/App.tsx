/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { 
  Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, 
  FolderOpen, Settings, ListMusic, Sliders, Music, 
  Search, Volume2, Waves, Disc, Sparkles, RotateCcw
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Types ---
interface Track {
  file: File;
  name: string;
  url: string;
}

type VisualizerMode = 'flow' | 'waveform' | 'orb';

interface EQPoint {
  freq: number;
  gain: number;
  label: string;
  x?: number;
  y?: number;
}

// --- Constants ---
const EQ_FREQS = [31, 63, 125, 250, 500, 750, 1000, 1500, 2000, 3000, 4000, 6000, 8000, 10000, 12000, 16000];
const MAX_GAIN = 15;

const VIZ_MODES: { id: VisualizerMode; label: string; icon: React.ReactNode }[] = [
  { id: 'flow', label: 'Generative Silk', icon: <Sparkles className="w-4 h-4" /> },
  { id: 'waveform', label: 'Ribbon Waveform', icon: <Waves className="w-4 h-4" /> },
  { id: 'orb', label: 'Pulse Core', icon: <Disc className="w-4 h-4" /> },
];

// --- Components ---

export default function App() {
  const [playlist, setPlaylist] = useState<Track[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isShuffle, setIsShuffle] = useState(false);
  const [isRepeat, setIsRepeat] = useState(false);
  const [visualizerMode, setVisualizerMode] = useState<VisualizerMode>('flow');
  const [activeTab, setActiveTab] = useState<'visualizer' | 'controls' | 'playlist'>('visualizer');
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const eqFiltersRef = useRef<BiquadFilterNode[]>([]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const eqCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationRef = useRef<number | null>(null);

  const [eqPoints, setEqPoints] = useState<EQPoint[]>(
    EQ_FREQS.map(freq => ({
      freq,
      gain: 0,
      label: freq >= 1000 ? `${(freq / 1000).toFixed(freq >= 10000 ? 0 : 1)}k` : `${freq}`
    }))
  );

  const currentTrack = playlist[currentIndex];

  // --- Audio Initialization ---
  const initAudio = useCallback(() => {
    if (audioCtxRef.current) return;

    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    audioCtxRef.current = ctx;

    const source = ctx.createMediaElementSource(audioRef.current!);
    sourceNodeRef.current = source;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.8;
    analyserRef.current = analyser;

    // EQ Filters
    const filters = eqPoints.map((point, i) => {
      const filter = ctx.createBiquadFilter();
      if (i === 0) filter.type = 'lowshelf';
      else if (i === eqPoints.length - 1) filter.type = 'highshelf';
      else filter.type = 'peaking';
      filter.frequency.value = point.freq;
      filter.Q.value = 1.1;
      filter.gain.value = point.gain;
      return filter;
    });
    eqFiltersRef.current = filters;

    // Chain: Source -> Filters -> Analyser -> Destination
    let lastNode: AudioNode = source;
    filters.forEach(filter => {
      lastNode.connect(filter);
      lastNode = filter;
    });
    lastNode.connect(analyser);
    analyser.connect(ctx.destination);
  }, [eqPoints]);

  // --- Playback Logic ---
  const playTrack = useCallback((index: number) => {
    if (!playlist[index]) return;
    setCurrentIndex(index);
    initAudio();
    if (audioCtxRef.current?.state === 'suspended') {
      audioCtxRef.current.resume();
    }
    
    // Small delay to ensure src is set before play
    setTimeout(() => {
      if (audioRef.current) {
        audioRef.current.play().catch(console.error);
        setIsPlaying(true);
      }
    }, 0);
  }, [playlist, initAudio]);

  const togglePlay = () => {
    if (!playlist.length) return;
    if (isPlaying) {
      audioRef.current?.pause();
      setIsPlaying(false);
    } else {
      initAudio();
      audioRef.current?.play();
      setIsPlaying(true);
    }
  };

  const nextTrack = useCallback(() => {
    if (!playlist.length) return;
    let nextIdx;
    if (isShuffle) {
      nextIdx = Math.floor(Math.random() * playlist.length);
    } else {
      nextIdx = (currentIndex + 1) % playlist.length;
    }
    playTrack(nextIdx);
  }, [playlist, isShuffle, currentIndex, playTrack]);

  const prevTrack = () => {
    if (!playlist.length) return;
    const prevIdx = (currentIndex - 1 + playlist.length) % playlist.length;
    playTrack(prevIdx);
  };

  const handleFolderUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    const audioFiles = files.filter(f => f.type.startsWith('audio/') || f.name.toLowerCase().endsWith('.mp3'));
    
    if (audioFiles.length > 0) {
      const newTracks = audioFiles.map(f => ({
        file: f,
        name: f.name.replace(/\.[^.]+$/, ''),
        url: URL.createObjectURL(f)
      }));
      setPlaylist(newTracks);
      setCurrentIndex(0);
      setIsPlaying(false);
    }
  };

  // --- EQ Logic ---
  useEffect(() => {
    eqFiltersRef.current.forEach((filter, i) => {
      if (filter) filter.gain.value = eqPoints[i].gain;
    });
  }, [eqPoints]);

  const resetEQ = () => {
    setEqPoints(prev => prev.map(p => ({ ...p, gain: 0 })));
  };

  // --- Visualizer Rendering ---
  const particlesRef = useRef<{x: number, y: number, vx: number, vy: number, size: number, color: string}[]>([]);
  const ripplesRef = useRef<{x: number, y: number, r: number, opacity: number}[]>([]);
  const mousePosRef = useRef<{x: number, y: number} | null>(null);

  // Initialize particles
  useEffect(() => {
    if (particlesRef.current.length > 0) return;
    const p = [];
    for (let i = 0; i < 300; i++) {
      p.push({
        x: Math.random() * 1600,
        y: Math.random() * 1200,
        vx: (Math.random() - 0.5) * 2,
        vy: (Math.random() - 0.5) * 2,
        size: Math.random() * 2 + 0.5,
        color: `hsla(${180 + Math.random() * 60}, 70%, 60%, 0.4)`
      });
    }
    particlesRef.current = p;
  }, []);

  const handleCanvasInteraction = (e: React.MouseEvent | React.TouchEvent) => {
    if (activeTab !== 'visualizer') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    mousePosRef.current = { x, y };
    if (e.type === 'mousedown' || e.type === 'touchstart') {
      ripplesRef.current.push({ x, y, r: 0, opacity: 1 });
    }
  };

  const handleCanvasLeave = () => {
    mousePosRef.current = null;
  };

  const drawParticles = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    const mouse = mousePosRef.current;
    const particles = particlesRef.current;
    const ripples = ripplesRef.current;

    // Update and draw particles
    particles.forEach(p => {
      // Interaction: particles move away from mouse
      if (mouse) {
        const dx = p.x - mouse.x;
        const dy = p.y - mouse.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 150) {
          const force = (150 - dist) / 150;
          p.vx += (dx / dist) * force * 0.5;
          p.vy += (dy / dist) * force * 0.5;
        }
      }

      // Friction and speed limit
      p.vx *= 0.99;
      p.vy *= 0.99;
      
      // Add a tiny bit of autonomous drift to keep them alive
      p.vx += (Math.random() - 0.5) * 0.02;
      p.vy += (Math.random() - 0.5) * 0.02;

      p.x += p.vx;
      p.y += p.vy;

      // Bounce
      if (p.x < 0) { p.x = 0; p.vx *= -1; }
      if (p.x > w) { p.x = w; p.vx *= -1; }
      if (p.y < 0) { p.y = 0; p.vy *= -1; }
      if (p.y > h) { p.y = h; p.vy *= -1; }

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();

      // Connect nearby particles
      particles.forEach(p2 => {
        const dx = p.x - p2.x;
        const dy = p.y - p2.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 80) {
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.strokeStyle = `rgba(103, 212, 255, ${0.15 * (1 - dist / 80)})`;
          ctx.stroke();
        }
      });
    });

    // Update and draw ripples
    ripplesRef.current = ripples.map(r => ({ ...r, r: r.r + 4, opacity: r.opacity - 0.02 })).filter(r => r.opacity > 0);
    ripplesRef.current.forEach(r => {
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(103, 212, 255, ${r.opacity})`;
      ctx.lineWidth = 2;
      ctx.stroke();
    });
  };

  const drawWaveform = (ctx: CanvasRenderingContext2D, w: number, h: number, timeData: Uint8Array, freqData: Uint8Array) => {
    const bass = freqData.slice(0, 10).reduce((a, b) => a + b, 0) / 10 / 255;
    const layers = 8;
    const segments = 120;
    
    ctx.globalCompositeOperation = 'lighter';
    
    for (let l = 0; l < layers; l++) {
      const n = l / layers;
      const hue = (190 + n * 80) % 360;
      const opacity = 0.1 + (1 - n) * 0.4;
      
      ctx.beginPath();
      ctx.strokeStyle = `hsla(${hue}, 90%, 70%, ${opacity})`;
      ctx.lineWidth = 1 + (1 - n) * 5;
      
      const amp = (h * 0.2) * (1 + bass * 1.2) * (0.4 + n * 0.6);
      const phase = performance.now() * 0.002 + n * Math.PI;
      
      for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const x = t * w;
        
        const sampleIdx = Math.floor(t * (timeData.length - 1));
        const audioVal = (timeData[sampleIdx] - 128) / 128;
        
        // 3D Perspective effect: waves get smaller towards the edges
        const perspective = Math.sin(t * Math.PI);
        const yOffset = audioVal * amp * perspective + Math.sin(t * Math.PI * 5 + phase) * (amp * 0.25);
        const y = h / 2 + yOffset + (n - 0.5) * 50 * perspective;
        
        if (i === 0) ctx.moveTo(x, y);
        else {
          const prevT = (i - 1) / segments;
          const prevX = prevT * w;
          ctx.quadraticCurveTo(prevX, h / 2 + yOffset, x, y);
        }
      }
      ctx.stroke();
      
      // Add a glow line in the middle of each layer
      ctx.lineWidth = 1;
      ctx.strokeStyle = `hsla(${hue}, 100%, 90%, ${opacity * 0.5})`;
      ctx.stroke();
    }
  };

  const drawOrb = (ctx: CanvasRenderingContext2D, w: number, h: number, freqData: Uint8Array) => {
    const cx = w / 2;
    const cy = h / 2;
    const bass = freqData.slice(0, 10).reduce((a, b) => a + b, 0) / 10 / 255;
    
    const baseRadius = Math.min(w, h) * 0.18;
    const radius = baseRadius * (1 + bass * 0.15); // Subtle core pulse
    
    // 1. Draw Background Glow
    const glowGrad = ctx.createRadialGradient(cx, cy, radius * 0.8, cx, cy, radius * 3);
    glowGrad.addColorStop(0, `rgba(103, 212, 255, ${0.2 + bass * 0.2})`);
    glowGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = glowGrad;
    ctx.fillRect(0, 0, w, h);

      // 2. Draw Reactive Spectrum Border (Rainbow Style)
      const barCount = 128;
      const spectrumRadius = radius + 10;
      
      for (let i = 0; i < barCount; i++) {
        const angle = (i / barCount) * Math.PI * 2;
        
        // Mirror the spectrum for symmetry
        const freqIdx = i < barCount / 2 ? i : barCount - i;
        const freqValue = freqData[Math.floor((freqIdx / (barCount / 2)) * (freqData.length * 0.5))];
        const intensity = (freqValue / 255) * 80 * (1 + bass * 0.5);
        
        const x1 = cx + Math.cos(angle) * spectrumRadius;
        const y1 = cy + Math.sin(angle) * spectrumRadius;
        const x2 = cx + Math.cos(angle) * (spectrumRadius + intensity);
        const y2 = cy + Math.sin(angle) * (spectrumRadius + intensity);
        
        const hue = (i / barCount) * 360;
        ctx.strokeStyle = `hsla(${hue}, 100%, 60%, 0.8)`;
        ctx.lineWidth = (w / barCount) * 1.2;
        ctx.lineCap = 'round';
        
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }

    // 3. Draw Central Disc
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = '#05060b'; // Dark center
    ctx.fill();
    
    // Inner logo-like glow
    const innerGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    innerGrad.addColorStop(0, 'rgba(255, 255, 255, 0.1)');
    innerGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = innerGrad;
    ctx.fill();

    // Border of the disc
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = 3;
    ctx.stroke();
  };

  useEffect(() => {
    const render = () => {
      if (!canvasRef.current || !analyserRef.current) {
        animationRef.current = requestAnimationFrame(render);
        return;
      }

      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d')!;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.width = canvas.clientWidth * dpr;
      const h = canvas.height = canvas.clientHeight * dpr;
      ctx.scale(dpr, dpr);
      
      const drawW = canvas.clientWidth;
      const drawH = canvas.clientHeight;

      const freqData = new Uint8Array(analyserRef.current.frequencyBinCount);
      const timeData = new Uint8Array(analyserRef.current.fftSize);
      analyserRef.current.getByteFrequencyData(freqData);
      analyserRef.current.getByteTimeDomainData(timeData);

      ctx.clearRect(0, 0, drawW, drawH);

      // Background Grid
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
      ctx.lineWidth = 1;
      const spacing = 40;
      for (let x = 0; x < drawW; x += spacing) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, drawH); ctx.stroke();
      }
      for (let y = 0; y < drawH; y += spacing) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(drawW, y); ctx.stroke();
      }

      const time = performance.now();
      if (visualizerMode === 'flow') drawParticles(ctx, drawW, drawH);
      else if (visualizerMode === 'waveform') drawWaveform(ctx, drawW, drawH, timeData, freqData);
      else if (visualizerMode === 'orb') drawOrb(ctx, drawW, drawH, freqData);

      animationRef.current = requestAnimationFrame(render);
    };

    render();
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [visualizerMode]);

  // --- EQ Canvas Rendering ---
  useEffect(() => {
    const canvas = eqCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width = canvas.clientWidth * dpr;
    const h = canvas.height = canvas.clientHeight * dpr;
    ctx.scale(dpr, dpr);
    
    const drawW = canvas.clientWidth;
    const drawH = canvas.clientHeight;
    const centerY = drawH / 2;
    const margin = 30;

    ctx.clearRect(0, 0, drawW, drawH);

    // Grid
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    for (let i = -15; i <= 15; i += 5) {
      const y = centerY - (i / MAX_GAIN) * (drawH / 2 - margin);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(drawW, y); ctx.stroke();
    }

    // Curve
    ctx.beginPath();
    ctx.strokeStyle = '#3b82f6'; // Normal blue
    ctx.lineWidth = 3;
    ctx.shadowBlur = 0;
    
    const points = eqPoints.map((p, i) => ({
      x: margin + (i / (eqPoints.length - 1)) * (drawW - margin * 2),
      y: centerY - (p.gain / MAX_GAIN) * (drawH / 2 - margin)
    }));

    points.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x, p.y);
      else {
        const prev = points[i - 1];
        const cpX = (prev.x + p.x) / 2;
        ctx.bezierCurveTo(cpX, prev.y, cpX, p.y, p.x, p.y);
      }
    });
    ctx.stroke();

    // Points
    points.forEach((p, i) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = '#0b0e17';
      ctx.fill();
      ctx.strokeStyle = '#3b82f6'; // Normal blue
      ctx.lineWidth = 2;
      ctx.stroke();
      
      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.font = '10px Inter';
      ctx.textAlign = 'center';
      ctx.fillText(eqPoints[i].label, p.x, drawH - 5);
    });

  }, [eqPoints, activeTab]);

  const handleEqInteraction = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = eqCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    const drawW = canvas.clientWidth;
    const drawH = canvas.clientHeight;
    const centerY = drawH / 2;
    const margin = 30;

    // Find closest point
    let closestIdx = -1;
    let minDist = Infinity;
    eqPoints.forEach((_, i) => {
      const px = margin + (i / (eqPoints.length - 1)) * (drawW - margin * 2);
      const dist = Math.abs(x - px);
      if (dist < minDist) {
        minDist = dist;
        closestIdx = i;
      }
    });

    if (closestIdx !== -1 && minDist < 30) {
      const newGain = Math.max(-MAX_GAIN, Math.min(MAX_GAIN, ((centerY - y) / (drawH / 2 - margin)) * MAX_GAIN));
      const newPoints = [...eqPoints];
      newPoints[closestIdx].gain = newGain;
      setEqPoints(newPoints);
    }
  };

  // --- Filtered Playlist ---
  const filteredPlaylist = useMemo(() => {
    return playlist.filter(t => t.name.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [playlist, searchQuery]);

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[#05060b]">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 bg-[#0b0e17]/80 backdrop-blur-xl border-b border-white/5 z-50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#67d4ff] to-[#d873ff] flex items-center justify-center shadow-lg shadow-cyan-500/20 overflow-hidden">
            <img src="/logo.svg" alt="Pulse Player logo" className="w-10 h-10 object-cover" />
          </div>
          <div>
            <h1 className="font-display font-bold text-lg tracking-tight text-white">Pulse Player</h1>
            <p className="text-[10px] uppercase tracking-widest text-white/40 font-medium">High Fidelity Audio</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 hover:border-cyan-500/50 transition-all cursor-pointer group">
            <FolderOpen className="w-4 h-4 text-cyan-400 group-hover:scale-110 transition-transform" />
            <span className="text-sm font-medium text-white">Load Folder</span>
            <input 
              type="file" 
              className="hidden" 
              multiple 
              // @ts-ignore - directory attributes
              webkitdirectory="" 
              directory="" 
              accept="audio/*" 
              onChange={handleFolderUpload} 
            />
          </label>

          <div className="relative group">
            <button className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 transition-all">
              <Settings className="w-4 h-4 text-purple-400" />
              <span className="text-sm font-medium text-white">Visualizer</span>
            </button>
            <div className="absolute right-0 top-full mt-2 w-48 bg-[#0b0e17] border border-white/10 rounded-2xl p-2 shadow-2xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
              {VIZ_MODES.map(mode => (
                <button
                  key={mode.id}
                  onClick={() => setVisualizerMode(mode.id)}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition-colors",
                    visualizerMode === mode.id ? "bg-cyan-500/10 text-cyan-400" : "hover:bg-white/5 text-white/60"
                  )}
                >
                  {mode.icon}
                  {mode.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <nav className="flex border-b border-white/5 bg-[#0b0e17]/40">
        {[
          { id: 'visualizer', label: 'Visualizer', icon: <Sparkles className="w-4 h-4" /> },
          { id: 'controls', label: 'Audio Engine', icon: <Sliders className="w-4 h-4" /> },
          { id: 'playlist', label: 'Playlist', icon: <ListMusic className="w-4 h-4" /> },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium transition-all relative",
              activeTab === tab.id ? "text-white" : "text-white/40 hover:text-white/60"
            )}
          >
            {tab.icon}
            {tab.label}
            {activeTab === tab.id && (
              <motion.div layoutId="activeTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-cyan-500" />
            )}
          </button>
        ))}
      </nav>

      {/* Main Content */}
      <main className="flex-1 relative overflow-hidden">
        <AnimatePresence mode="wait">
          {activeTab === 'visualizer' && (
            <motion.div
              key="viz"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.05 }}
              className="absolute inset-0"
              onMouseDown={handleCanvasInteraction}
              onMouseMove={handleCanvasInteraction}
              onMouseUp={handleCanvasLeave}
              onMouseLeave={handleCanvasLeave}
              onTouchStart={handleCanvasInteraction}
              onTouchMove={handleCanvasInteraction}
              onTouchEnd={handleCanvasLeave}
            >
              <canvas ref={canvasRef} className="w-full h-full" />
              <div className="absolute bottom-6 left-6 p-4 rounded-2xl bg-black/40 backdrop-blur-md border border-white/10">
                <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">Now Playing</p>
                <h3 className="font-display font-bold text-white truncate max-w-[200px]">
                  {currentTrack?.name || "No Track Selected"}
                </h3>
              </div>
              <div className="absolute top-6 right-6 px-4 py-2 rounded-full bg-black/40 backdrop-blur-md border border-white/10 text-[10px] uppercase tracking-widest font-bold text-cyan-400">
                Mode: {VIZ_MODES.find(m => m.id === visualizerMode)?.label}
              </div>
            </motion.div>
          )}

          {activeTab === 'controls' && (
            <motion.div
              key="controls"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="absolute inset-0 p-8 overflow-y-auto custom-scrollbar"
            >
              <div className="max-w-4xl mx-auto space-y-8">
                {/* EQ Section */}
                <section className="bg-white/5 rounded-3xl p-8 border border-white/10">
                  <div className="flex items-center justify-between mb-8">
                    <div>
                      <h2 className="font-display font-bold text-2xl tracking-tight text-white">Parametric EQ</h2>
                      <p className="text-sm text-white/40">16-Band Precision Graphic Equalizer</p>
                    </div>
                    <button 
                      onClick={resetEQ}
                      className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all text-sm text-white"
                    >
                      <RotateCcw className="w-4 h-4" />
                      Reset
                    </button>
                  </div>
                  <div className="h-64 relative bg-black/20 rounded-2xl border border-white/5 overflow-hidden">
                    <canvas 
                      ref={eqCanvasRef} 
                      className="w-full h-full cursor-ns-resize"
                      onMouseMove={(e) => e.buttons === 1 && handleEqInteraction(e)}
                      onMouseDown={handleEqInteraction}
                      onTouchMove={handleEqInteraction}
                    />
                  </div>
                </section>

                {/* Playback Settings */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <section className="bg-white/5 rounded-3xl p-8 border border-white/10">
                    <h3 className="font-display font-bold text-lg mb-6 flex items-center gap-2 text-white">
                      <Volume2 className="w-5 h-5 text-cyan-400" />
                      Playback Speed
                    </h3>
                    <div className="space-y-4">
                      <input 
                        type="range" min="0.5" max="2" step="0.1" 
                        value={playbackRate} 
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          setPlaybackRate(val);
                          if (audioRef.current) audioRef.current.playbackRate = val;
                        }}
                        className="w-full accent-cyan-500"
                      />
                      <div className="flex justify-between text-xs font-mono text-white/40">
                        <span className="text-white/40">0.5x</span>
                        <span className="text-cyan-400 font-bold">{playbackRate.toFixed(1)}x</span>
                        <span className="text-white/40">2.0x</span>
                      </div>
                    </div>
                  </section>

                  <section className="bg-white/5 rounded-3xl p-8 border border-white/10">
                    <h3 className="font-display font-bold text-lg mb-6 flex items-center gap-2 text-white">
                      <Sparkles className="w-5 h-5 text-purple-400" />
                      Audio Engine
                    </h3>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="p-4 rounded-2xl bg-black/20 border border-white/5">
                        <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">Sample Rate</p>
                        <p className="font-mono text-cyan-400">44.1 kHz</p>
                      </div>
                      <div className="p-4 rounded-2xl bg-black/20 border border-white/5">
                        <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">FFT Size</p>
                        <p className="font-mono text-purple-400">2048</p>
                      </div>
                    </div>
                  </section>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'playlist' && (
            <motion.div
              key="playlist"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="absolute inset-0 p-8"
            >
              <div className="max-w-4xl mx-auto h-full flex flex-col">
                <div className="relative mb-6">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/20" />
                  <input 
                    type="text" 
                    placeholder="Search your library..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 pl-12 pr-4 outline-none focus:border-cyan-500/50 transition-all text-white"
                  />
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-2">
                  {filteredPlaylist.length > 0 ? (
                    filteredPlaylist.map((track, idx) => {
                      const originalIdx = playlist.indexOf(track);
                      const isActive = originalIdx === currentIndex;
                      return (
                        <button
                          key={track.url}
                          onClick={() => playTrack(originalIdx)}
                          className={cn(
                            "w-full flex items-center gap-4 p-4 rounded-2xl transition-all group",
                            isActive ? "bg-cyan-500/10 border border-cyan-500/20" : "hover:bg-white/5 border border-transparent"
                          )}
                        >
                          <div className={cn(
                            "w-10 h-10 rounded-lg flex items-center justify-center transition-all",
                            isActive ? "bg-cyan-500 text-white" : "bg-white/5 text-white/20 group-hover:text-white/40"
                          )}>
                            {isActive && isPlaying ? (
                              <div className="flex gap-0.5 items-end h-4">
                                <motion.div animate={{ height: [4, 16, 8] }} transition={{ repeat: Infinity, duration: 0.5 }} className="w-1 bg-white" />
                                <motion.div animate={{ height: [8, 4, 16] }} transition={{ repeat: Infinity, duration: 0.6 }} className="w-1 bg-white" />
                                <motion.div animate={{ height: [16, 8, 4] }} transition={{ repeat: Infinity, duration: 0.4 }} className="w-1 bg-white" />
                              </div>
                            ) : (
                              <Music className="w-5 h-5" />
                            )}
                          </div>
                          <div className="flex-1 text-left">
                            <p className={cn("font-medium truncate", isActive ? "text-white" : "text-white/60")}>{track.name}</p>
                            <p className="text-[10px] uppercase tracking-widest text-white/20">MP3 Audio</p>
                          </div>
                          <div className="text-xs font-mono text-white/20">
                            {isActive ? "Playing" : "Ready"}
                          </div>
                        </button>
                      );
                    })
                  ) : (
                    <div className="flex flex-col items-center justify-center h-64 text-white/20">
                      <ListMusic className="w-12 h-12 mb-4 opacity-20" />
                      <p>No tracks found in library</p>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer Controls */}
      <footer className="bg-[#0b0e17] border-t border-white/5 px-8 py-6 z-50">
        <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-8 items-center">
          {/* Track Info */}
          <div className="hidden md:flex items-center gap-4">
            <div className="w-12 h-12 rounded-md bg-white/5 border border-white/10 flex items-center justify-center overflow-hidden">
              {isPlaying ? (
                <motion.div 
                  animate={{ rotate: 360 }} 
                  transition={{ repeat: Infinity, duration: 4, ease: "linear" }}
                  className="w-8 h-8 rounded-full border-2 border-dashed border-cyan-500/50 flex items-center justify-center"
                >
                  <Disc className="w-4 h-4 text-cyan-400" />
                </motion.div>
              ) : (
                <Disc className="w-6 h-6 text-white/10" />
              )}
            </div>
            <div className="min-w-0">
              <h4 className="font-bold text-sm truncate text-white">{currentTrack?.name || "Pulse Player"}</h4>
              <p className="text-[10px] uppercase tracking-widest text-white/40">
                {isPlaying ? "Streaming Now" : "Paused"}
              </p>
            </div>
          </div>

          {/* Main Controls */}
          <div className="flex flex-col items-center gap-4">
            <div className="flex items-center gap-6">
              <button 
                onClick={() => setIsShuffle(!isShuffle)}
                className={cn("transition-colors", isShuffle ? "text-cyan-400" : "text-white/20 hover:text-white/40")}
              >
                <Shuffle className="w-4 h-4" />
              </button>
              <button onClick={prevTrack} className="text-white/60 hover:text-white transition-colors">
                <SkipBack className="w-6 h-6" />
              </button>
              <button 
                onClick={togglePlay}
                className="w-14 h-14 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 active:scale-95 transition-all shadow-xl shadow-white/10"
              >
                {isPlaying ? <Pause className="w-6 h-6 fill-current" /> : <Play className="w-6 h-6 fill-current ml-1" />}
              </button>
              <button onClick={nextTrack} className="text-white/60 hover:text-white transition-colors">
                <SkipForward className="w-6 h-6" />
              </button>
              <button 
                onClick={() => setIsRepeat(!isRepeat)}
                className={cn("transition-colors", isRepeat ? "text-cyan-400" : "text-white/20 hover:text-white/40")}
              >
                <Repeat className="w-4 h-4" />
              </button>
            </div>

            <div className="w-full flex items-center gap-4">
              <span className="text-[10px] font-mono text-white/40 w-10 text-right">
                {new Date(currentTime * 1000).toISOString().substr(14, 5)}
              </span>
              <div className="flex-1 h-3 bg-white/5 rounded-full relative group cursor-pointer overflow-hidden border border-white/5">
                <div 
                  className="absolute inset-y-0 left-0 bg-gradient-to-r from-cyan-500 to-purple-500 rounded-full"
                  style={{ width: `${(currentTime / duration) * 100}%` }}
                />
                <input 
                  type="range" 
                  min="0" max={duration || 0} step="0.1"
                  value={currentTime}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    setCurrentTime(val);
                    if (audioRef.current) audioRef.current.currentTime = val;
                  }}
                  className="absolute inset-0 opacity-0 cursor-pointer"
                />
              </div>
              <span className="text-[10px] font-mono text-white/40 w-10">
                {new Date(duration * 1000).toISOString().substr(14, 5)}
              </span>
            </div>
          </div>

          {/* Volume / Extra */}
          <div className="hidden md:flex items-center justify-end gap-4">
            <div className="flex items-center gap-3 bg-white/5 px-4 py-2 rounded-full border border-white/10">
              <Volume2 className="w-4 h-4 text-white/40" />
              <input 
                type="range" min="0" max="1" step="0.01" 
                defaultValue="1"
                onChange={(e) => {
                  if (audioRef.current) audioRef.current.volume = parseFloat(e.target.value);
                }}
                className="w-24 accent-cyan-500"
              />
            </div>
          </div>
        </div>
      </footer>

      {/* Hidden Audio Element */}
      <audio 
        ref={audioRef} 
        src={currentTrack?.url}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onDurationChange={(e) => setDuration(e.currentTarget.duration)}
        onEnded={nextTrack}
      />
    </div>
  );
}
