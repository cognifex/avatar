const drawCanvas = document.getElementById('drawCanvas');
const drawGuideCanvas = document.getElementById('drawGuideCanvas');
const outputCanvas = document.getElementById('outputCanvas');

const brushSizeInput = document.getElementById('brushSize');
const clearBtn = document.getElementById('clearBtn');
const detectBtn = document.getElementById('detectBtn');
const copyBtn = document.getElementById('copyBtn');
const micBtn = document.getElementById('micBtn');
const stopMicBtn = document.getElementById('stopMicBtn');
const sensitivityInput = document.getElementById('sensitivityInput');
const latencyInput = document.getElementById('latencyInput');
const regionSelect = document.getElementById('regionSelect');
const drawRegionBtn = document.getElementById('drawRegionBtn');
const adoptRegionBtn = document.getElementById('adoptRegionBtn');
const resetRegionBtn = document.getElementById('resetRegionBtn');
const statusEl = document.getElementById('status');
const transparentBg = document.getElementById('transparentBg');
const expressiveMotionToggle = document.getElementById('expressiveMotionToggle');
const outputWrap = document.getElementById('outputWrap');

const drawCtx = drawCanvas.getContext('2d');
const guideCtx = drawGuideCanvas.getContext('2d');
const outputCtx = outputCanvas.getContext('2d');

const bufferCanvas = document.createElement('canvas');
bufferCanvas.width = drawCanvas.width;
bufferCanvas.height = drawCanvas.height;
const bufferCtx = bufferCanvas.getContext('2d');

let drawing = false;
let audioCtx;
let analyser;
let micStream;
let audioLoopId;
let renderId;

const audioState = {
  level: 0,
  pitchHz: 0,
  visemeWeights: {
    closed: 1,
    open: 0,
    wide: 0,
    round: 0,
    fv: 0,
  },
  featureState: {
    energy: 0,
    lowBand: 0,
    midBand: 0,
    highBand: 0,
    centroidNorm: 0,
    zeroCrossNorm: 0,
  },
  visemeHoldUntil: 0,
  transientBoostFrames: 0,
  prevTransientSignal: 0,
};

const animationTuning = {
  visemeSmoothing: {
    attackBase: 0.36,
    releaseBase: 0.14,
    latencyAttackFactor: 0.24,
    latencyReleaseFactor: 0.09,
    alphaClamp: { min: 0.03, max: 0.9 },
    perViseme: {
      open: { attackMul: 1.35, releaseMul: 0.58 },
      wide: { attackMul: 1.32, releaseMul: 1.0 },
      fv: { attackMul: 1.45, releaseMul: 0.75 },
    },
  },
  hold: {
    baseMs: 16,
    latencyMsFactor: 52,
    energyMsFactor: 36,
    minMs: 8,
    maxMs: 88,
    strongOpenThresholds: { open: 0.2, wide: 0.14, round: 0.14, fv: 0.18 },
  },
  transientBoost: {
    signalWeights: { highBand: 0.62, zeroCrossNorm: 0.38 },
    riseThreshold: 0.2,
    frames: 2,
    fvBoost: 0.22,
  },
};

const avatarState = {
  faceBox: null,
  autoFaceRegions: null,
  faceRegions: {},
  baseFrame: null,
};

const motionState = {
  enabled: true,
  drift: 0,
  microNoise: 0,
  nod: 0,
  prevEnergy: 0,
};

const regionEditState = {
  active: false,
  target: 'mouth',
  draftRect: null,
  dragStart: null,
  polygonPoints: [],
  hoverPoint: null,
};

setupDrawing();
renderId = requestAnimationFrame(renderOutput);

clearBtn.addEventListener('click', () => {
  drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
  guideCtx.clearRect(0, 0, drawGuideCanvas.width, drawGuideCanvas.height);
  outputCtx.clearRect(0, 0, outputCanvas.width, outputCanvas.height);
  avatarState.faceBox = null;
  avatarState.autoFaceRegions = null;
  avatarState.faceRegions = {};
  avatarState.baseFrame = null;
  stopRegionEdit(false);
  setStatus('Zeichnung gelöscht. Bitte neu zeichnen und Gesicht erkennen.');
});

detectBtn.addEventListener('click', () => {
  const box = detectFaceBoxFromDrawing();
  if (!box) {
    avatarState.faceBox = null;
    avatarState.autoFaceRegions = null;
    drawFaceGuide();
    setStatus('Kein Gesicht gefunden. Zeichne den Kopf deutlicher (geschlossene Form hilft).');
    return;
  }

  const regions = detectFaceRegionsFromDrawing(box);
  avatarState.faceBox = box;
  avatarState.autoFaceRegions = regions;
  drawFaceGuide();
  setStatus(buildDetectionStatus(box, regions));
});

copyBtn.addEventListener('click', () => {
  avatarState.baseFrame = drawCtx.getImageData(0, 0, drawCanvas.width, drawCanvas.height);
  outputCtx.putImageData(avatarState.baseFrame, 0, 0);
  if (!avatarState.faceBox) {
    setStatus('Zeichnung wurde in den Output übernommen. Tipp: Zusätzlich "Gesicht erkennen" für Animation.');
    return;
  }
  setStatus('Zeichnung inkl. erkanntem Gesicht in den Output übernommen. Neutral = exakt deine Zeichnung.');
});

micBtn.addEventListener('click', async () => {
  try {
    await startMic();
    micBtn.disabled = true;
    stopMicBtn.disabled = false;
    setStatus('Mikrofon aktiv. Output wird jetzt über deinem neutralen Gesicht animiert.');
  } catch (err) {
    console.error(err);
    setStatus('Mikrofon konnte nicht gestartet werden. Bitte Berechtigung prüfen.');
  }
});

stopMicBtn.addEventListener('click', () => {
  stopMic();
  micBtn.disabled = false;
  stopMicBtn.disabled = true;
  setStatus('Mikrofon gestoppt.');
});

transparentBg.addEventListener('change', () => {
  outputWrap.classList.toggle('transparent', transparentBg.checked);
});

expressiveMotionToggle?.addEventListener('change', () => {
  motionState.enabled = expressiveMotionToggle.checked;
});

regionSelect.addEventListener('change', () => {
  regionEditState.target = regionSelect.value;
  if (regionEditState.active) {
    stopRegionEdit(false);
    startRegionEdit();
  } else {
    drawFaceGuide();
  }
});

drawRegionBtn.addEventListener('click', () => {
  if (regionEditState.active) {
    stopRegionEdit();
    return;
  }
  startRegionEdit();
});

adoptRegionBtn.addEventListener('click', () => {
  const key = regionSelect.value;
  const autoRegion = avatarState.autoFaceRegions?.[key];
  if (!autoRegion) {
    setStatus('Keine erkannte Region vorhanden. Erst Gesicht erkennen oder Region manuell zeichnen.');
    return;
  }
  avatarState.faceRegions[key] = toManualRegion(autoRegion);
  drawFaceGuide();
  setStatus(`Automatisch erkannte Region für "${getRegionLabel(key)}" wurde als fixiert übernommen.`);
});

resetRegionBtn.addEventListener('click', () => {
  const key = regionSelect.value;
  delete avatarState.faceRegions[key];
  drawFaceGuide();
  setStatus(`Manuelle Region für "${getRegionLabel(key)}" zurückgesetzt. Automatische Erkennung wird verwendet.`);
});

function setupDrawing() {
  drawCtx.lineCap = 'round';
  drawCtx.lineJoin = 'round';
  drawCtx.strokeStyle = '#f8fafc';

  drawCanvas.addEventListener('pointerdown', (event) => {
    drawing = true;
    const p = getPos(event, drawCanvas);
    drawCtx.beginPath();
    drawCtx.moveTo(p.x, p.y);
  });

  drawCanvas.addEventListener('pointermove', (event) => {
    if (!drawing) return;
    const p = getPos(event, drawCanvas);
    drawCtx.lineWidth = Number(brushSizeInput.value);
    drawCtx.lineTo(p.x, p.y);
    drawCtx.stroke();
  });

  const endStroke = () => {
    if (!drawing) return;
    drawing = false;
    drawCtx.closePath();
  };

  drawCanvas.addEventListener('pointerup', endStroke);
  drawCanvas.addEventListener('pointerleave', endStroke);

  drawGuideCanvas.addEventListener('pointerdown', onGuidePointerDown);
  drawGuideCanvas.addEventListener('pointermove', onGuidePointerMove);
  drawGuideCanvas.addEventListener('pointerup', onGuidePointerUp);
  drawGuideCanvas.addEventListener('dblclick', onGuideDoubleClick);
  drawGuideCanvas.addEventListener('contextmenu', (event) => event.preventDefault());
}

function getPos(event, canvas) {
  const rect = canvas.getBoundingClientRect();
  const sx = canvas.width / rect.width;
  const sy = canvas.height / rect.height;
  return {
    x: (event.clientX - rect.left) * sx,
    y: (event.clientY - rect.top) * sy,
  };
}

function detectFaceBoxFromDrawing() {
  const width = drawCanvas.width;
  const height = drawCanvas.height;
  const image = drawCtx.getImageData(0, 0, width, height);
  const data = image.data;

  const visited = new Uint8Array(width * height);
  const components = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (visited[idx] || !isInkPixel(data, width, x, y)) continue;
      const comp = floodComponent(data, width, height, x, y, visited);
      if (comp.area > 120) components.push(comp);
    }
  }

  if (!components.length) return null;

  const scored = components
    .map((comp) => {
      const w = comp.maxX - comp.minX + 1;
      const h = comp.maxY - comp.minY + 1;
      const aspect = w / h;
      const roundish = 1 - Math.min(1, Math.abs(1 - aspect));
      const topFactor = 1 - comp.cy / height;
      const areaFactor = Math.min(1, comp.area / 9000);
      const score = roundish * 0.45 + topFactor * 0.35 + areaFactor * 0.2;
      return { comp, w, h, score };
    })
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  const padX = Math.max(10, best.w * 0.15);
  const padY = Math.max(12, best.h * 0.18);
  const x = Math.max(0, best.comp.minX - padX);
  const y = Math.max(0, best.comp.minY - padY);
  const maxX = Math.min(width, best.comp.maxX + padX);
  const maxY = Math.min(height, best.comp.maxY + padY);

  return {
    x,
    y,
    w: maxX - x,
    h: maxY - y,
  };
}

function isInkPixel(data, width, x, y) {
  const off = (y * width + x) * 4;
  return data[off + 3] > 25;
}

function floodComponent(data, width, height, sx, sy, visited) {
  const stack = [[sx, sy]];
  let area = 0;
  let sumX = 0;
  let sumY = 0;
  let minX = sx;
  let minY = sy;
  let maxX = sx;
  let maxY = sy;

  while (stack.length) {
    const [x, y] = stack.pop();
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    const idx = y * width + x;
    if (visited[idx]) continue;
    visited[idx] = 1;
    if (!isInkPixel(data, width, x, y)) continue;

    area++;
    sumX += x;
    sumY += y;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);

    stack.push([x + 1, y]);
    stack.push([x - 1, y]);
    stack.push([x, y + 1]);
    stack.push([x, y - 1]);
  }

  return {
    area,
    cx: sumX / Math.max(area, 1),
    cy: sumY / Math.max(area, 1),
    minX,
    minY,
    maxX,
    maxY,
  };
}

function drawFaceGuide() {
  guideCtx.clearRect(0, 0, drawGuideCanvas.width, drawGuideCanvas.height);
  if (avatarState.faceBox) {
    const { x, y, w, h } = avatarState.faceBox;
    guideCtx.save();
    guideCtx.strokeStyle = '#22d3ee';
    guideCtx.lineWidth = 2;
    guideCtx.setLineDash([8, 6]);
    guideCtx.strokeRect(x, y, w, h);
    guideCtx.fillStyle = '#22d3ee';
    guideCtx.font = '16px sans-serif';
    guideCtx.fillText('Erkanntes Gesicht', x + 8, Math.max(18, y - 8));
    guideCtx.restore();
  }

  const overlays = [
    { key: 'mouth', label: 'Mund', stroke: '#f97316', fill: 'rgba(249, 115, 22, 0.24)' },
    { key: 'leftEye', label: 'Auge links', stroke: '#38bdf8', fill: 'rgba(56, 189, 248, 0.22)' },
    { key: 'rightEye', label: 'Auge rechts', stroke: '#818cf8', fill: 'rgba(129, 140, 248, 0.22)' },
    { key: 'brows', label: 'Brauen', stroke: '#a3e635', fill: 'rgba(163, 230, 53, 0.2)' },
    { key: 'jaw', label: 'Kiefer', stroke: '#facc15', fill: 'rgba(250, 204, 21, 0.18)' },
  ];

  overlays.forEach((overlay) => {
    const region = getPreferredRegion(overlay.key);
    if (!region) return;
    const isManual = Boolean(avatarState.faceRegions?.[overlay.key]?.manual);
    drawRegionOverlay(region, overlay, isManual);
  });

  drawRegionDraftOverlay();
}

function drawRegionOverlay(region, overlay, isManual = false) {
  guideCtx.save();
  guideCtx.strokeStyle = overlay.stroke;
  guideCtx.fillStyle = overlay.fill;
  guideCtx.lineWidth = isManual ? 3 : 2;
  guideCtx.setLineDash(isManual ? [10, 4] : []);

  if (region.type === 'polygon' && region.points?.length >= 3) {
    guideCtx.beginPath();
    guideCtx.moveTo(region.points[0].x, region.points[0].y);
    for (let i = 1; i < region.points.length; i++) {
      guideCtx.lineTo(region.points[i].x, region.points[i].y);
    }
    guideCtx.closePath();
    guideCtx.fill();
    guideCtx.stroke();
  } else if (region.type === 'rect') {
    guideCtx.fillRect(region.x, region.y, region.w, region.h);
    guideCtx.strokeRect(region.x, region.y, region.w, region.h);
  }

  const labelX = region.type === 'rect' ? region.x + 6 : region.points[0].x + 6;
  const labelY = region.type === 'rect' ? region.y - 6 : region.points[0].y - 6;
  guideCtx.fillStyle = overlay.stroke;
  guideCtx.font = '13px sans-serif';
  guideCtx.fillText(isManual ? `${overlay.label} (fixiert)` : overlay.label, labelX, Math.max(14, labelY));
  guideCtx.restore();
}

function detectFaceRegionsFromDrawing(faceBox) {
  const { x, y, w, h } = faceBox;
  const width = drawCanvas.width;
  const image = drawCtx.getImageData(0, 0, drawCanvas.width, drawCanvas.height);
  const data = image.data;

  const clampedBox = {
    x: Math.max(0, Math.floor(x)),
    y: Math.max(0, Math.floor(y)),
    w: Math.max(1, Math.ceil(w)),
    h: Math.max(1, Math.ceil(h)),
  };

  const regions = {
    mouth: detectBandRect(data, width, clampedBox, [0.54, 0.92], [0.2, 0.85]),
    leftEye: detectBandRect(data, width, clampedBox, [0.2, 0.55], [0.05, 0.5]),
    rightEye: detectBandRect(data, width, clampedBox, [0.2, 0.55], [0.5, 0.95]),
    brows: detectBrowsPolygon(data, width, clampedBox),
    jaw: detectBandRect(data, width, clampedBox, [0.78, 1.0], [0.08, 0.92]),
  };

  return regions;
}

function detectBandRect(data, width, faceBox, yRange, xRange) {
  const rx = faceBox.x + faceBox.w * xRange[0];
  const ry = faceBox.y + faceBox.h * yRange[0];
  const rw = faceBox.w * (xRange[1] - xRange[0]);
  const rh = faceBox.h * (yRange[1] - yRange[0]);
  const box = {
    x: Math.floor(rx),
    y: Math.floor(ry),
    w: Math.max(2, Math.ceil(rw)),
    h: Math.max(2, Math.ceil(rh)),
  };
  const rect = detectLargestInkRect(data, width, box);
  if (rect) return rect;

  return {
    type: 'rect',
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h,
    estimated: true,
  };
}

function detectLargestInkRect(data, width, box) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let count = 0;

  for (let yy = box.y; yy < box.y + box.h; yy++) {
    for (let xx = box.x; xx < box.x + box.w; xx++) {
      if (!isInkPixel(data, width, xx, yy)) continue;
      minX = Math.min(minX, xx);
      minY = Math.min(minY, yy);
      maxX = Math.max(maxX, xx);
      maxY = Math.max(maxY, yy);
      count++;
    }
  }

  if (count < 12 || !Number.isFinite(minX)) return null;
  return {
    type: 'rect',
    x: minX,
    y: minY,
    w: Math.max(2, maxX - minX + 1),
    h: Math.max(2, maxY - minY + 1),
    estimated: false,
  };
}

function detectBrowsPolygon(data, width, faceBox) {
  const browBand = detectBandRect(data, width, faceBox, [0.07, 0.33], [0.05, 0.95]);
  if (!browBand) return null;
  const { x, y, w, h } = browBand;
  return {
    type: 'polygon',
    points: [
      { x: x, y: y + h },
      { x: x + w * 0.12, y: y + h * 0.15 },
      { x: x + w * 0.32, y: y },
      { x: x + w * 0.5, y: y + h * 0.2 },
      { x: x + w * 0.68, y: y },
      { x: x + w * 0.88, y: y + h * 0.15 },
      { x: x + w, y: y + h },
    ],
    estimated: !!browBand.estimated,
  };
}

function buildDetectionStatus(faceBox, regions) {
  const checks = [
    { key: 'mouth', label: 'Mund' },
    { key: 'leftEye', label: 'Auge links' },
    { key: 'rightEye', label: 'Auge rechts' },
    { key: 'brows', label: 'Brauen' },
  ];

  const hit = [];
  const unsure = [];
  checks.forEach((item) => {
    const region = regions?.[item.key];
    if (region && !region.estimated) hit.push(item.label);
    else unsure.push(item.label);
  });

  const boxText = `Gesicht erkannt (x=${Math.round(faceBox.x)}, y=${Math.round(faceBox.y)}, w=${Math.round(faceBox.w)}, h=${Math.round(faceBox.h)}).`;
  if (!hit.length) return `${boxText} Regionen unsicher: ${unsure.join(', ')}.`;
  if (!unsure.length) return `${boxText} Regionen erkannt: ${hit.join(', ')}.`;
  return `${boxText} ${hit.join(', ')} erkannt, unsicher: ${unsure.join(', ')}.`;
}

async function startMic() {
  micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  audioCtx = new AudioContext();
  const source = audioCtx.createMediaStreamSource(micStream);
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);

  const timeData = new Float32Array(analyser.fftSize);
  const freqData = new Float32Array(analyser.frequencyBinCount);

  const loop = () => {
    analyser.getFloatTimeDomainData(timeData);
    analyser.getFloatFrequencyData(freqData);

    const features = extractFrameFeatures(timeData, freqData, audioCtx.sampleRate);
    const sensitivity = Number(sensitivityInput?.value || 1);
    const latency = Number(latencyInput?.value || 0.35);
    audioState.level = smoothWithLatency(audioState.level, features.energy, latency);

    const pitch = estimatePitch(timeData, audioCtx.sampleRate);
    audioState.pitchHz = smoothWithLatency(audioState.pitchHz, pitch, latency * 0.8);
    audioState.featureState = {
      energy: smoothWithLatency(audioState.featureState.energy, features.energy, latency),
      lowBand: smoothWithLatency(audioState.featureState.lowBand, features.bands.low, latency),
      midBand: smoothWithLatency(audioState.featureState.midBand, features.bands.mid, latency),
      highBand: smoothWithLatency(audioState.featureState.highBand, features.bands.high, latency),
      centroidNorm: smoothWithLatency(audioState.featureState.centroidNorm, features.centroidNorm, latency),
      zeroCrossNorm: smoothWithLatency(audioState.featureState.zeroCrossNorm, features.zeroCrossNorm, latency),
    };

    const targetVisemes = deriveVisemeWeights(audioState.featureState, audioState.pitchHz, sensitivity);
    audioState.visemeWeights = smoothVisemeWeights(audioState.visemeWeights, targetVisemes, latency, audioState);

    audioLoopId = requestAnimationFrame(loop);
  };

  loop();
}

function stopMic() {
  if (audioLoopId) cancelAnimationFrame(audioLoopId);
  audioLoopId = undefined;

  if (micStream) {
    micStream.getTracks().forEach((t) => t.stop());
    micStream = null;
  }

  if (audioCtx) {
    audioCtx.close();
    audioCtx = null;
  }

  analyser = null;
  audioState.level = 0;
  audioState.pitchHz = 0;
  audioState.visemeWeights = { closed: 1, open: 0, wide: 0, round: 0, fv: 0 };
  audioState.featureState = { energy: 0, lowBand: 0, midBand: 0, highBand: 0, centroidNorm: 0, zeroCrossNorm: 0 };
  audioState.visemeHoldUntil = 0;
}

function estimatePitch(samples, sampleRate) {
  let bestOffset = -1;
  let bestCorr = 0;
  const minLag = Math.floor(sampleRate / 420);
  const maxLag = Math.floor(sampleRate / 70);

  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0;
    for (let i = 0; i < samples.length - lag; i++) {
      corr += samples[i] * samples[i + lag];
    }
    corr /= samples.length - lag;
    if (corr > bestCorr) {
      bestCorr = corr;
      bestOffset = lag;
    }
  }

  if (bestOffset < 0 || bestCorr < 0.01) return 0;
  return sampleRate / bestOffset;
}

function smooth(prev, next, alpha) {
  return prev + alpha * (next - prev);
}

function smoothWithLatency(prev, next, latencyNorm) {
  const clamped = clamp(latencyNorm, 0, 1);
  const alpha = 0.42 - clamped * 0.32;
  return smooth(prev, next, alpha);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function extractFrameFeatures(timeData, freqData, sampleRate) {
  const energy = Math.sqrt(timeData.reduce((acc, v) => acc + v * v, 0) / timeData.length);
  let zeroCrossings = 0;
  for (let i = 1; i < timeData.length; i++) {
    if ((timeData[i - 1] >= 0 && timeData[i] < 0) || (timeData[i - 1] < 0 && timeData[i] >= 0)) zeroCrossings++;
  }
  const zeroCrossNorm = clamp(zeroCrossings / (timeData.length * 0.26), 0, 1);

  const nyquist = sampleRate / 2;
  const binHz = nyquist / freqData.length;
  let totalMag = 0;
  let centroidNum = 0;
  let low = 0;
  let mid = 0;
  let high = 0;

  for (let i = 0; i < freqData.length; i++) {
    const mag = Number.isFinite(freqData[i]) ? Math.pow(10, freqData[i] / 20) : 0;
    const hz = i * binHz;
    totalMag += mag;
    centroidNum += mag * hz;
    if (hz < 500) low += mag;
    else if (hz < 2500) mid += mag;
    else high += mag;
  }

  const invTotal = 1 / Math.max(1e-6, totalMag);
  const centroidNorm = clamp((centroidNum * invTotal) / 4200, 0, 1);
  return {
    energy: clamp(energy * 6, 0, 1),
    zeroCrossNorm,
    centroidNorm,
    bands: {
      low: clamp((low * invTotal) * 2.2, 0, 1),
      mid: clamp((mid * invTotal) * 2.2, 0, 1),
      high: clamp((high * invTotal) * 3.1, 0, 1),
    },
  };
}

function deriveVisemeWeights(features, pitchHz, sensitivity) {
  const sens = clamp(sensitivity, 0.6, 2.2);
  const voicedEnergy = clamp(features.energy * sens, 0, 1);
  const low = features.lowBand;
  const mid = features.midBand;
  const high = features.highBand;
  const centroid = features.centroidNorm;
  const zc = features.zeroCrossNorm;

  const open = clamp((voicedEnergy - 0.14) * 1.35 + (mid - 0.28) * 0.6, 0, 1);
  const wide = clamp(open * (centroid - 0.2) * 1.6 + clamp((pitchHz - 185) / 180, 0, 1) * 0.5, 0, 1);
  const round = clamp(open * (low - high * 0.55) * 1.55 + clamp((170 - pitchHz) / 170, 0, 1) * 0.3, 0, 1);
  const fv = clamp((high * 1.55 + zc * 0.8 - 0.58) * 1.35 * (0.55 + voicedEnergy * 0.6), 0, 1);

  const openLike = Math.max(open * 0.9, wide * 0.6, round * 0.58, fv * 0.42);
  const closed = clamp(1 - openLike * 1.2 - voicedEnergy * 0.3, 0, 1);

  return normalizeVisemeWeights({ closed, open, wide, round, fv });
}

function normalizeVisemeWeights(weights) {
  const clean = {
    closed: clamp(weights.closed || 0, 0, 1),
    open: clamp(weights.open || 0, 0, 1),
    wide: clamp(weights.wide || 0, 0, 1),
    round: clamp(weights.round || 0, 0, 1),
    fv: clamp(weights.fv || 0, 0, 1),
  };
  const sum = clean.closed + clean.open + clean.wide + clean.round + clean.fv;
  if (sum < 1e-5) return { closed: 1, open: 0, wide: 0, round: 0, fv: 0 };
  return {
    closed: clean.closed / sum,
    open: clean.open / sum,
    wide: clean.wide / sum,
    round: clean.round / sum,
    fv: clean.fv / sum,
  };
}

function smoothVisemeWeights(current, target, latency, state) {
  const tuning = animationTuning;
  const now = performance.now();
  const features = state.featureState || {};
  const signalWeights = tuning.transientBoost.signalWeights;
  const transientSignal = clamp(
    (features.highBand || 0) * signalWeights.highBand + (features.zeroCrossNorm || 0) * signalWeights.zeroCrossNorm,
    0,
    1,
  );
  const transientRise = transientSignal - (state.prevTransientSignal || 0);
  state.prevTransientSignal = transientSignal;
  if (transientRise > tuning.transientBoost.riseThreshold) {
    state.transientBoostFrames = tuning.transientBoost.frames;
  }
  const boostedTarget = { ...target };
  if ((state.transientBoostFrames || 0) > 0) {
    boostedTarget.fv = clamp(boostedTarget.fv + tuning.transientBoost.fvBoost, 0, 1);
    state.transientBoostFrames -= 1;
  }

  const holdMs = clamp(
    tuning.hold.baseMs + latency * tuning.hold.latencyMsFactor + (features.energy || 0) * tuning.hold.energyMsFactor,
    tuning.hold.minMs,
    tuning.hold.maxMs,
  );

  const th = tuning.hold.strongOpenThresholds;
  const hasStrongOpen = boostedTarget.open > th.open || boostedTarget.wide > th.wide || boostedTarget.round > th.round || boostedTarget.fv > th.fv;
  if (hasStrongOpen) state.visemeHoldUntil = now + holdMs;
  const holdActive = now < state.visemeHoldUntil;

  const next = {};
  ['closed', 'open', 'wide', 'round', 'fv'].forEach((key) => {
    const prev = current[key] ?? (key === 'closed' ? 1 : 0);
    let desired = boostedTarget[key] ?? 0;
    if (holdActive && key === 'closed') desired = Math.min(desired, prev);
    const visemeTuning = tuning.visemeSmoothing.perViseme[key] || {};
    const attack = (tuning.visemeSmoothing.attackBase - latency * tuning.visemeSmoothing.latencyAttackFactor) * (visemeTuning.attackMul || 1);
    const release = (tuning.visemeSmoothing.releaseBase - latency * tuning.visemeSmoothing.latencyReleaseFactor) * (visemeTuning.releaseMul || 1);
    const alpha = desired > prev ? attack : release;
    next[key] = smooth(prev, desired, clamp(alpha, tuning.visemeSmoothing.alphaClamp.min, tuning.visemeSmoothing.alphaClamp.max));
  });
  return normalizeVisemeWeights(next);
}

function renderOutput() {
  outputCtx.clearRect(0, 0, outputCanvas.width, outputCanvas.height);

  if (avatarState.baseFrame) {
    outputCtx.putImageData(avatarState.baseFrame, 0, 0);

    if (avatarState.faceBox) {
      const mouthRegion = resolveMouthRegion(avatarState.faceBox);
      animateMouthFromRegion(mouthRegion, audioState.visemeWeights);
    }

    if (avatarState.faceBox && audioState.level > 0.04) {
      animateHeadBounce(avatarState.faceBox, audioState.level, audioState.featureState, audioState.pitchHz);
      if (motionState.enabled) {
        animateExpressionRegions(avatarState.faceBox, audioState.featureState, audioState.pitchHz);
      }
    }
  }

  renderId = requestAnimationFrame(renderOutput);
}

function animateMouthFromRegion(mouthRegion, visemeWeights) {
  if (!mouthRegion) return;
  const bounds = getRegionBounds(mouthRegion);
  if (!bounds) return;
  const srcAnchors = buildMouthAnchors(bounds);
  const dstAnchors = deformMouthAnchors(srcAnchors, bounds, visemeWeights);

  bufferCtx.clearRect(0, 0, bufferCanvas.width, bufferCanvas.height);
  bufferCtx.drawImage(outputCanvas, 0, 0);

  outputCtx.save();
  traceRegionPath(outputCtx, mouthRegion);
  outputCtx.clip();
  outputCtx.clearRect(bounds.x - 2, bounds.y - 2, bounds.w + 4, bounds.h + 4);

  const triangles = [
    ['tl', 'upperLeft', 'leftCorner'],
    ['tl', 'upperMid', 'upperLeft'],
    ['tl', 'tr', 'upperMid'],
    ['tr', 'upperRight', 'upperMid'],
    ['tr', 'rightCorner', 'upperRight'],
    ['leftCorner', 'upperLeft', 'innerUpperMid'],
    ['upperLeft', 'upperMid', 'innerUpperMid'],
    ['upperMid', 'upperRight', 'innerUpperMid'],
    ['upperRight', 'rightCorner', 'innerUpperMid'],
    ['leftCorner', 'innerUpperMid', 'center'],
    ['innerUpperMid', 'rightCorner', 'center'],
    ['leftCorner', 'center', 'innerLowerMid'],
    ['center', 'rightCorner', 'innerLowerMid'],
    ['leftCorner', 'innerLowerMid', 'lowerLeft'],
    ['innerLowerMid', 'lowerMid', 'lowerLeft'],
    ['lowerMid', 'innerLowerMid', 'lowerRight'],
    ['innerLowerMid', 'rightCorner', 'lowerRight'],
    ['bl', 'leftCorner', 'lowerLeft'],
    ['bl', 'lowerLeft', 'lowerMid'],
    ['bl', 'lowerMid', 'br'],
    ['br', 'lowerMid', 'lowerRight'],
    ['br', 'lowerRight', 'rightCorner'],
    ['bl', 'tl', 'leftCorner'],
    ['tr', 'br', 'rightCorner'],
  ];

  triangles.forEach((triangle) => {
    const srcTri = triangle.map((key) => srcAnchors[key]);
    const dstTri = triangle.map((key) => dstAnchors[key]);
    warpTriangle(bufferCanvas, outputCtx, srcTri, dstTri);
  });

  outputCtx.restore();
}

function resolveMouthRegion(faceBox) {
  const mouthRegion = getPreferredRegion('mouth');
  if (mouthRegion) return mouthRegion;
  return {
    type: 'rect',
    x: faceBox.x,
    y: faceBox.y + faceBox.h * 0.55,
    w: faceBox.w,
    h: faceBox.h * 0.33,
    estimated: true,
  };
}

function getRegionBounds(region) {
  if (region?.type === 'rect') return region;
  if (region?.type !== 'polygon' || !region.points?.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  region.points.forEach((point) => {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  });
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function traceRegionPath(ctx, region) {
  ctx.beginPath();
  if (region.type === 'polygon' && region.points?.length >= 3) {
    ctx.moveTo(region.points[0].x, region.points[0].y);
    for (let i = 1; i < region.points.length; i++) {
      ctx.lineTo(region.points[i].x, region.points[i].y);
    }
    ctx.closePath();
    return;
  }
  ctx.rect(region.x, region.y, region.w, region.h);
}

function buildMouthAnchors(bounds) {
  const { x, y, w, h } = bounds;
  return {
    tl: { x, y },
    tr: { x: x + w, y },
    br: { x: x + w, y: y + h },
    bl: { x, y: y + h },
    leftCorner: { x: x + w * 0.2, y: y + h * 0.56 },
    rightCorner: { x: x + w * 0.8, y: y + h * 0.56 },
    upperLeft: { x: x + w * 0.34, y: y + h * 0.45 },
    upperMid: { x: x + w * 0.5, y: y + h * 0.42 },
    upperRight: { x: x + w * 0.66, y: y + h * 0.45 },
    lowerLeft: { x: x + w * 0.34, y: y + h * 0.7 },
    lowerMid: { x: x + w * 0.5, y: y + h * 0.72 },
    lowerRight: { x: x + w * 0.66, y: y + h * 0.7 },
    innerUpperMid: { x: x + w * 0.5, y: y + h * 0.5 },
    innerLowerMid: { x: x + w * 0.5, y: y + h * 0.64 },
    center: { x: x + w * 0.5, y: y + h * 0.57 },
  };
}

function deformMouthAnchors(anchors, bounds, visemeWeights) {
  const deformed = Object.fromEntries(
    Object.entries(anchors).map(([key, point]) => [key, { x: point.x, y: point.y }]),
  );
  const { w, h } = bounds;
  const closed = visemeWeights?.closed ?? 1;
  const open = visemeWeights?.open ?? 0;
  const wide = visemeWeights?.wide ?? 0;
  const round = visemeWeights?.round ?? 0;
  const fv = visemeWeights?.fv ?? 0;

  // Viseme coefficient table (dx = horizontal width units, dy = vertical height units)
  // open  -> jaw drop + slight corner spread
  // wide  -> corners move outward, reduced vertical opening
  // round -> stronger horizontal pull-in + vertical compression
  // fv    -> targeted upper/lower lip compression and subtle asymmetry
  // closed-> stabilizes neutral closure and lip contact
  const visemeProfiles = {
    leftCorner: { dx: { closed: 0.024, open: -0.018, wide: -0.15, round: 0.145, fv: 0.015 }, dy: { closed: 0.016, open: 0.01, wide: -0.008, round: -0.02, fv: 0.022 }, clampX: 0.18, clampY: 0.11 },
    rightCorner: { dx: { closed: -0.024, open: 0.018, wide: 0.15, round: -0.145, fv: -0.015 }, dy: { closed: 0.016, open: 0.01, wide: -0.008, round: -0.02, fv: 0.022 }, clampX: 0.18, clampY: 0.11 },
    upperLeft: { dx: { closed: 0.006, open: -0.012, wide: -0.04, round: 0.048, fv: 0.026 }, dy: { closed: 0.026, open: -0.05, wide: 0.006, round: 0.052, fv: 0.096 }, clampX: 0.1, clampY: 0.14 },
    upperMid: { dx: { closed: 0, open: 0, wide: 0, round: 0, fv: 0 }, dy: { closed: 0.058, open: -0.1, wide: 0.012, round: 0.078, fv: 0.122 }, clampX: 0.06, clampY: 0.16 },
    upperRight: { dx: { closed: -0.006, open: 0.012, wide: 0.04, round: -0.048, fv: -0.026 }, dy: { closed: 0.026, open: -0.05, wide: 0.006, round: 0.052, fv: 0.096 }, clampX: 0.1, clampY: 0.14 },
    lowerLeft: { dx: { closed: 0.006, open: -0.012, wide: -0.035, round: 0.046, fv: 0.02 }, dy: { closed: -0.046, open: 0.152, wide: 0.016, round: -0.06, fv: -0.098 }, clampX: 0.1, clampY: 0.18 },
    lowerMid: { dx: { closed: 0, open: 0, wide: 0, round: 0, fv: 0 }, dy: { closed: -0.094, open: 0.228, wide: 0.052, round: -0.082, fv: -0.128 }, clampX: 0.06, clampY: 0.22 },
    lowerRight: { dx: { closed: -0.006, open: 0.012, wide: 0.035, round: -0.046, fv: -0.02 }, dy: { closed: -0.046, open: 0.152, wide: 0.016, round: -0.06, fv: -0.098 }, clampX: 0.1, clampY: 0.18 },
    innerUpperMid: { dx: { closed: 0, open: 0, wide: 0, round: 0, fv: 0 }, dy: { closed: 0.042, open: -0.082, wide: 0.004, round: 0.072, fv: 0.11 }, clampX: 0.05, clampY: 0.16 },
    innerLowerMid: { dx: { closed: 0, open: 0, wide: 0, round: 0, fv: 0 }, dy: { closed: -0.062, open: 0.166, wide: 0.034, round: -0.078, fv: -0.112 }, clampX: 0.05, clampY: 0.18 },
  };

  const weights = { closed, open, wide, round, fv };
  Object.entries(visemeProfiles).forEach(([key, profile]) => {
    if (!deformed[key]) return;
    const base = anchors[key];
    const dx = Object.entries(profile.dx).reduce((sum, [viseme, factor]) => sum + weights[viseme] * factor, 0);
    const dy = Object.entries(profile.dy).reduce((sum, [viseme, factor]) => sum + weights[viseme] * factor, 0);
    const nextX = base.x + w * dx;
    const nextY = base.y + h * dy;
    deformed[key].x = clamp(nextX, base.x - w * profile.clampX, base.x + w * profile.clampX);
    deformed[key].y = clamp(nextY, base.y - h * profile.clampY, base.y + h * profile.clampY);
  });

  deformed.center.x = (deformed.innerUpperMid.x + deformed.innerLowerMid.x + deformed.leftCorner.x + deformed.rightCorner.x) / 4;
  deformed.center.y = (deformed.upperMid.y + deformed.lowerMid.y + deformed.innerUpperMid.y + deformed.innerLowerMid.y) / 4;
  return deformed;
}

function warpTriangle(sourceCanvas, targetCtx, srcTri, dstTri) {
  const transform = affineFromTriangles(srcTri, dstTri);
  if (!transform) return;
  targetCtx.save();
  targetCtx.beginPath();
  targetCtx.moveTo(dstTri[0].x, dstTri[0].y);
  targetCtx.lineTo(dstTri[1].x, dstTri[1].y);
  targetCtx.lineTo(dstTri[2].x, dstTri[2].y);
  targetCtx.closePath();
  targetCtx.clip();
  targetCtx.setTransform(transform.a, transform.b, transform.c, transform.d, transform.e, transform.f);
  targetCtx.drawImage(sourceCanvas, 0, 0);
  targetCtx.restore();
}

function affineFromTriangles(srcTri, dstTri) {
  const [p1, p2, p3] = srcTri;
  const [q1, q2, q3] = dstTri;
  const det = p1.x * (p2.y - p3.y) + p2.x * (p3.y - p1.y) + p3.x * (p1.y - p2.y);
  if (Math.abs(det) < 1e-6) return null;

  const a = (q1.x * (p2.y - p3.y) + q2.x * (p3.y - p1.y) + q3.x * (p1.y - p2.y)) / det;
  const b = (q1.y * (p2.y - p3.y) + q2.y * (p3.y - p1.y) + q3.y * (p1.y - p2.y)) / det;
  const c = (q1.x * (p3.x - p2.x) + q2.x * (p1.x - p3.x) + q3.x * (p2.x - p1.x)) / det;
  const d = (q1.y * (p3.x - p2.x) + q2.y * (p1.x - p3.x) + q3.y * (p2.x - p1.x)) / det;
  const e = (q1.x * (p2.x * p3.y - p3.x * p2.y) + q2.x * (p3.x * p1.y - p1.x * p3.y) + q3.x * (p1.x * p2.y - p2.x * p1.y)) / det;
  const f = (q1.y * (p2.x * p3.y - p3.x * p2.y) + q2.y * (p3.x * p1.y - p1.x * p3.y) + q3.y * (p1.x * p2.y - p2.x * p1.y)) / det;

  return { a, b, c, d, e, f };
}

function animateHeadBounce(faceBox, level, features = {}, pitchHz = 0) {
  const { x, y, w, h } = faceBox;
  const energy = features.energy || level || 0;
  const lowBand = features.lowBand || 0;
  const centroidNorm = features.centroidNorm || 0;
  const pitchBoost = clamp((pitchHz - 180) / 420, 0, 1);
  const brightBoost = clamp((centroidNorm - 0.35) * 0.5 + pitchBoost * 0.25, 0, 0.42);
  const dynamics = 1 + brightBoost;

  motionState.drift = smooth(motionState.drift, (lowBand - 0.5) * h * 0.03 * dynamics, 0.08);
  const noiseTarget = (Math.random() * 2 - 1) * h * 0.012 * (0.35 + energy * 0.65);
  motionState.microNoise = smooth(motionState.microNoise, noiseTarget, 0.07);

  const energyRise = energy - (motionState.prevEnergy || 0);
  motionState.prevEnergy = energy;
  if (energyRise > 0.08 && energy > 0.12) {
    motionState.nod = Math.min(motionState.nod + energyRise * h * 0.11 * dynamics, h * 0.09);
  }
  motionState.nod *= 0.82;
  const offsetY = clamp(motionState.drift + motionState.microNoise + motionState.nod, -h * 0.1, h * 0.1);

  bufferCtx.clearRect(0, 0, bufferCanvas.width, bufferCanvas.height);
  bufferCtx.drawImage(outputCanvas, 0, 0);

  outputCtx.clearRect(x - 2, y - 2, w + 4, h + 4);
  outputCtx.drawImage(bufferCanvas, x, y, w, h, x, y + offsetY, w, h);
}

function animateExpressionRegions(faceBox, features = {}, pitchHz = 0) {
  const emphasis = clamp((features.energy || 0) * 0.55 + (features.highBand || 0) * 0.3 + (features.centroidNorm || 0) * 0.15, 0, 1);
  if (emphasis < 0.08) return;

  const brightBoost = clamp((features.centroidNorm || 0) * 0.6 + clamp((pitchHz - 200) / 350, 0, 1) * 0.4, 0, 1);
  const eyeShift = -(0.008 + brightBoost * 0.012) * emphasis;
  const browShift = -(0.014 + brightBoost * 0.02) * emphasis;

  morphRegionVertical(getPreferredRegion('leftEye'), faceBox, eyeShift, faceBox.h * 0.025);
  morphRegionVertical(getPreferredRegion('rightEye'), faceBox, eyeShift, faceBox.h * 0.025);
  morphRegionVertical(getPreferredRegion('brows'), faceBox, browShift, faceBox.h * 0.035);
}

function morphRegionVertical(region, faceBox, scaleDelta, pixelCap) {
  if (!region) return;
  const bounds = getRegionBounds(region);
  if (!bounds) return;
  const dy = clamp(scaleDelta * bounds.h, -pixelCap, pixelCap);
  const hardCap = faceBox.h * 0.08;
  const finalDy = clamp(dy, -hardCap, hardCap);

  bufferCtx.clearRect(0, 0, bufferCanvas.width, bufferCanvas.height);
  bufferCtx.drawImage(outputCanvas, 0, 0);

  outputCtx.save();
  traceRegionPath(outputCtx, region);
  outputCtx.clip();
  outputCtx.clearRect(bounds.x - 2, bounds.y - 2, bounds.w + 4, bounds.h + 4);
  outputCtx.drawImage(bufferCanvas, bounds.x, bounds.y, bounds.w, bounds.h, bounds.x, bounds.y + finalDy, bounds.w, bounds.h);
  outputCtx.restore();
}

function setStatus(message) {
  statusEl.textContent = message;
}

function getPreferredRegion(key) {
  return avatarState.faceRegions?.[key] || avatarState.autoFaceRegions?.[key] || null;
}

function startRegionEdit() {
  regionEditState.active = true;
  regionEditState.target = regionSelect.value;
  regionEditState.dragStart = null;
  regionEditState.draftRect = null;
  regionEditState.polygonPoints = [];
  regionEditState.hoverPoint = null;
  drawGuideCanvas.style.pointerEvents = 'auto';
  drawRegionBtn.textContent = 'Markieren beenden';
  setStatus(`Markierungsmodus aktiv (${getRegionLabel(regionEditState.target)}).`);
  drawFaceGuide();
}

function stopRegionEdit(showStatus = true) {
  regionEditState.active = false;
  regionEditState.dragStart = null;
  regionEditState.draftRect = null;
  regionEditState.polygonPoints = [];
  regionEditState.hoverPoint = null;
  drawGuideCanvas.style.pointerEvents = 'none';
  drawRegionBtn.textContent = 'Region zeichnen/markieren';
  if (showStatus) setStatus('Markierungsmodus beendet.');
  drawFaceGuide();
}

function onGuidePointerDown(event) {
  if (!regionEditState.active) return;
  const shape = getRegionShape(regionEditState.target);
  const p = getPos(event, drawGuideCanvas);

  if (shape === 'polygon') {
    if (regionEditState.polygonPoints.length >= 3 && isNearPoint(p, regionEditState.polygonPoints[0])) {
      saveManualPolygon();
      return;
    }
    regionEditState.polygonPoints.push(p);
    drawFaceGuide();
    return;
  }

  regionEditState.dragStart = p;
  regionEditState.draftRect = { type: 'rect', x: p.x, y: p.y, w: 1, h: 1, manual: true, estimated: false };
  drawGuideCanvas.setPointerCapture(event.pointerId);
}

function onGuidePointerMove(event) {
  if (!regionEditState.active) return;
  const p = getPos(event, drawGuideCanvas);
  const shape = getRegionShape(regionEditState.target);
  if (shape === 'polygon') {
    regionEditState.hoverPoint = p;
    drawFaceGuide();
    return;
  }
  if (!regionEditState.dragStart) return;
  regionEditState.draftRect = createRectFromPoints(regionEditState.dragStart, p);
  drawFaceGuide();
}

function onGuidePointerUp(event) {
  if (!regionEditState.active) return;
  if (!regionEditState.dragStart || !regionEditState.draftRect) return;
  drawGuideCanvas.releasePointerCapture(event.pointerId);
  if (regionEditState.draftRect.w < 4 || regionEditState.draftRect.h < 4) {
    regionEditState.dragStart = null;
    regionEditState.draftRect = null;
    drawFaceGuide();
    return;
  }
  avatarState.faceRegions[regionEditState.target] = {
    ...regionEditState.draftRect,
    manual: true,
    estimated: false,
  };
  stopRegionEdit(false);
  setStatus(`Region "${getRegionLabel(regionEditState.target)}" manuell fixiert.`);
}

function onGuideDoubleClick() {
  if (!regionEditState.active || getRegionShape(regionEditState.target) !== 'polygon') return;
  saveManualPolygon();
}

function saveManualPolygon() {
  if (regionEditState.polygonPoints.length < 3) {
    setStatus('Für Brauen mindestens 3 Punkte setzen, dann doppelklicken.');
    return;
  }
  avatarState.faceRegions[regionEditState.target] = {
    type: 'polygon',
    points: regionEditState.polygonPoints.map((point) => ({ x: point.x, y: point.y })),
    manual: true,
    estimated: false,
  };
  stopRegionEdit(false);
  setStatus(`Region "${getRegionLabel(regionEditState.target)}" manuell fixiert.`);
}

function drawRegionDraftOverlay() {
  if (!regionEditState.active) return;
  guideCtx.save();
  guideCtx.lineWidth = 2;
  guideCtx.strokeStyle = '#f472b6';
  guideCtx.fillStyle = 'rgba(244, 114, 182, 0.22)';
  guideCtx.setLineDash([6, 4]);

  const shape = getRegionShape(regionEditState.target);
  if (shape === 'polygon') {
    const points = regionEditState.polygonPoints;
    if (points.length) {
      guideCtx.beginPath();
      guideCtx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        guideCtx.lineTo(points[i].x, points[i].y);
      }
      if (regionEditState.hoverPoint) {
        guideCtx.lineTo(regionEditState.hoverPoint.x, regionEditState.hoverPoint.y);
      }
      guideCtx.stroke();
    }
    points.forEach((point) => {
      guideCtx.beginPath();
      guideCtx.arc(point.x, point.y, 4, 0, Math.PI * 2);
      guideCtx.fill();
    });
  } else if (regionEditState.draftRect) {
    const rect = regionEditState.draftRect;
    guideCtx.fillRect(rect.x, rect.y, rect.w, rect.h);
    guideCtx.strokeRect(rect.x, rect.y, rect.w, rect.h);
  }
  guideCtx.restore();
}

function getRegionShape(regionKey) {
  return regionKey === 'brows' ? 'polygon' : 'rect';
}

function createRectFromPoints(start, end) {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const w = Math.max(1, Math.abs(end.x - start.x));
  const h = Math.max(1, Math.abs(end.y - start.y));
  return { type: 'rect', x, y, w, h, manual: true, estimated: false };
}

function isNearPoint(a, b, threshold = 10) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy) <= threshold;
}

function toManualRegion(region) {
  if (region.type === 'polygon') {
    return {
      type: 'polygon',
      points: region.points.map((point) => ({ x: point.x, y: point.y })),
      manual: true,
      estimated: false,
    };
  }
  return {
    type: 'rect',
    x: region.x,
    y: region.y,
    w: region.w,
    h: region.h,
    manual: true,
    estimated: false,
  };
}

function getRegionLabel(key) {
  return (
    {
      mouth: 'Mund',
      leftEye: 'linkes Auge',
      rightEye: 'rechtes Auge',
      brows: 'Brauen',
    }[key] || key
  );
}
