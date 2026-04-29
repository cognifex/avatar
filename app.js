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
const profileSelect = document.getElementById('profileSelect');
const responsivenessInput = document.getElementById('responsivenessInput');
const expressivenessInput = document.getElementById('expressivenessInput');
const trackingSmoothnessInput = document.getElementById('trackingSmoothnessInput');
const trackingResponsivenessInput = document.getElementById('trackingResponsivenessInput');
const regionSelect = document.getElementById('regionSelect');
const drawRegionBtn = document.getElementById('drawRegionBtn');
const adoptRegionBtn = document.getElementById('adoptRegionBtn');
const resetRegionBtn = document.getElementById('resetRegionBtn');
const trackingToggleBtn = document.getElementById('trackingToggleBtn');
const modeSelect = document.getElementById('modeSelect');
const debugOverlayToggle = document.getElementById('debugOverlayToggle');
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
let trackingLoopId;

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
  expressionState: {
    intensity: 0,
    eyeLift: 0,
    browLift: 0,
    headTilt: 0,
    mouthCorner: 0,
  },
  expressionTiming: {
    phase: 'idle',
    peak: 0,
    holdUntil: 0,
    hitUntil: 0,
    releaseUntil: 0,
    cooldownUntil: 0,
    microFreezeFrames: 0,
    prevVoiced: false,
  },
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

const STORAGE_KEYS = {
  profile: 'avatar.profile',
  responsiveness: 'avatar.responsiveness',
  expressiveness: 'avatar.expressiveness',
  trackingSmoothness: 'avatar.trackingSmoothness',
  trackingResponsiveness: 'avatar.trackingResponsiveness',
  trackingEnabled: 'avatar.trackingEnabled',
  mode: 'avatar.mode',
  debugOverlay: 'avatar.debugOverlay',
};

const ANIMATION_PROFILES = {
  natural: {
    visemeSensitivity: 1,
    visemeSmoothingAttackMul: 1,
    visemeSmoothingReleaseMul: 1,
    headMotionMul: 1,
    mouthDeformMul: 1,
    transientBoostMul: 1,
  },
  energetic: {
    visemeSensitivity: 1.2,
    visemeSmoothingAttackMul: 1.22,
    visemeSmoothingReleaseMul: 1.05,
    headMotionMul: 1.25,
    mouthDeformMul: 1.15,
    transientBoostMul: 1.3,
  },
  cartoon: {
    visemeSensitivity: 1.35,
    visemeSmoothingAttackMul: 1.35,
    visemeSmoothingReleaseMul: 0.9,
    headMotionMul: 1.55,
    mouthDeformMul: 1.4,
    transientBoostMul: 1.45,
  },
};

const runtimeProfileState = {
  profile: 'natural',
  responsiveness: 0.5,
  expressiveness: 0.5,
  mode: 'tracking_audio',
};

const avatarState = {
  faceBox: null,
  autoFaceRegions: null,
  faceRegions: {},
  baseFrame: null,
};

const landmarkExpressionState = {
  valid: false,
  mouth: { open: 0, wide: 0, round: 0, corners: 0 },
  eyes: { openness: 0, squeeze: 0 },
  brows: { lift: 0, frown: 0 },
};

const motionState = {
  enabled: true,
  drift: 0,
  microNoise: 0,
  nod: 0,
  prevEnergy: 0,
};

const trackingState = {
  enabled: false,
  desiredEnabled: true,
  landmarks: [],
  confidence: 0,
  lastSeenTs: 0,
  pose: { yaw: 0, pitch: 0, roll: 0 },
  fallbackMode: true,
  filtered: new Map(),
  diagnostics: {
    jitterScore: 0,
    dropFrames: 0,
    outlierRejects: 0,
  },
  status: 'idle',
};

const trackingConfig = {
  fps: 24,
  minConfidence: 0.5,
  lostFaceMs: 700,
  maxMovementNorm: 0.085,
  clampMovementNorm: 0.045,
  trackingSmoothness: 0.55,
  trackingResponsiveness: 0.5,
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
hydrateProfileSettings();
bindProfileControls();
bindTrackingControls();
startFaceTracking();
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
  if (!trackingState.desiredEnabled || runtimeProfileState.mode === 'audio_only') {
    if (!trackingState.fallbackMode) applyTrackingFallback('disabled');
    return;
  }

  if (!box) {
    avatarState.faceBox = null;
    avatarState.autoFaceRegions = null;
    drawFaceGuide();
    setStatus('Kein Gesicht gefunden. Zeichne den Kopf deutlicher (geschlossene Form hilft).');
    trackingState.status = trackingState.lastSeenTs ? 'reacquiring' : 'face_lost';
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

function normalizeRect(rect, width, height) {
  if (!rect) return null;
  return {
    x: rect.x / width,
    y: rect.y / height,
    w: rect.w / width,
    h: rect.h / height,
  };
}

function normalizePolygon(points, width, height) {
  if (!Array.isArray(points) || points.length === 0) return [];
  return points.map((point) => ({ x: point.x / width, y: point.y / height }));
}

function collectTrackingLandmarks(faceBox, regions, width, height) {
  const keys = ['leftEye', 'rightEye', 'brows', 'mouth'];
  const landmarks = [];
  keys.forEach((key) => {
    const region = regions?.[key];
    if (!region) return;
    if (region.type === 'polygon') {
      landmarks.push({ key, type: 'polygon', points: normalizePolygon(region.points, width, height) });
    } else {
      landmarks.push({ key, type: 'rect', rect: normalizeRect(region, width, height) });
    }
  });
  if (faceBox) landmarks.push({ key: 'face', type: 'rect', rect: normalizeRect(faceBox, width, height) });
  return landmarks;
}

function flattenLandmarkValues(entry) {
  if (!entry) return [];
  if (entry.type === 'rect' && entry.rect) return [entry.rect.x, entry.rect.y, entry.rect.w, entry.rect.h];
  if (entry.type === 'polygon' && Array.isArray(entry.points)) return entry.points.flatMap((point) => [point.x, point.y]);
  return [];
}

function confidenceWeightedBlend(raw, filtered, confidence = 1) {
  const baseBlend = 0.2 + trackingConfig.trackingSmoothness * 0.75;
  const lowConfidenceBoost = (1 - clamp(confidence, 0, 1)) * 0.5;
  const blend = clamp(baseBlend + lowConfidenceBoost, 0.1, 0.95);
  return smooth(raw, filtered, blend);
}

function adaptiveSmooth(raw, prev, velocity, dt, confidence) {
  if (!Number.isFinite(prev)) return raw;
  const speed = Math.abs(velocity) / Math.max(1e-6, dt);
  const responsiveness = 0.08 + trackingConfig.trackingResponsiveness * 0.65;
  const dynamic = 1 - Math.exp(-speed * (0.4 + responsiveness));
  const alpha = clamp(0.06 + dynamic * (0.35 + responsiveness * 0.4), 0.04, 0.95);
  const ema = smooth(prev, raw, alpha);
  return confidenceWeightedBlend(raw, ema, confidence);
}

function smoothLandmarkEntry(entry, prevEntry, dt, confidence) {
  if (!entry) return entry;
  if (!prevEntry) return entry;
  if (entry.type === 'rect' && entry.rect && prevEntry.rect) {
    const nextRect = {};
    ['x', 'y', 'w', 'h'].forEach((key) => {
      const raw = entry.rect[key];
      const prev = prevEntry.rect[key];
      const velocity = raw - prev;
      nextRect[key] = adaptiveSmooth(raw, prev, velocity, dt, confidence);
    });
    return { ...entry, rect: nextRect };
  }
  if (entry.type === 'polygon' && Array.isArray(entry.points) && Array.isArray(prevEntry.points)) {
    const points = entry.points.map((point, idx) => {
      const prev = prevEntry.points[idx] || point;
      const nx = adaptiveSmooth(point.x, prev.x, point.x - prev.x, dt, confidence);
      const ny = adaptiveSmooth(point.y, prev.y, point.y - prev.y, dt, confidence);
      return { x: nx, y: ny };
    });
    return { ...entry, points };
  }
  return entry;
}

function clampLandmarkMovement(entry, prevEntry) {
  if (!entry || !prevEntry) return { entry, rejected: false };
  const current = flattenLandmarkValues(entry);
  const prev = flattenLandmarkValues(prevEntry);
  if (current.length !== prev.length || current.length === 0) return { entry, rejected: false };
  const diffs = current.map((value, idx) => value - prev[idx]);
  const maxAbs = diffs.reduce((acc, value) => Math.max(acc, Math.abs(value)), 0);
  if (maxAbs <= trackingConfig.maxMovementNorm) return { entry, rejected: false };
  const ratio = trackingConfig.clampMovementNorm / Math.max(1e-6, maxAbs);
  if (entry.type === 'rect' && entry.rect && prevEntry.rect) {
    const rect = {};
    ['x', 'y', 'w', 'h'].forEach((key) => {
      rect[key] = prevEntry.rect[key] + (entry.rect[key] - prevEntry.rect[key]) * ratio;
    });
    return { entry: { ...entry, rect }, rejected: true };
  }
  if (entry.type === 'polygon' && Array.isArray(entry.points) && Array.isArray(prevEntry.points)) {
    const points = entry.points.map((point, idx) => {
      const prevPoint = prevEntry.points[idx] || point;
      return {
        x: prevPoint.x + (point.x - prevPoint.x) * ratio,
        y: prevPoint.y + (point.y - prevPoint.y) * ratio,
      };
    });
    return { entry: { ...entry, points }, rejected: true };
  }
  return { entry, rejected: true };
}

function estimatePoseFromFace(faceBox) {
  if (!faceBox) return { yaw: 0, pitch: 0, roll: 0 };
  const centerX = faceBox.x + faceBox.w / 2;
  const centerY = faceBox.y + faceBox.h / 2;
  return {
    yaw: clamp((centerX / drawCanvas.width - 0.5) * 2, -1, 1),
    pitch: clamp((centerY / drawCanvas.height - 0.5) * 2, -1, 1),
    roll: 0,
  };
}

function applyTrackingFallback(status = 'face_lost') {
  trackingState.enabled = false;
  trackingState.fallbackMode = true;
  trackingState.confidence = 0;
  trackingState.landmarks = [];
  trackingState.pose = { yaw: 0, pitch: 0, roll: 0 };
  trackingState.filtered.clear();
  trackingState.status = status;
}

function analyzeTrackingFrame(now = performance.now()) {
  const box = detectFaceBoxFromDrawing();
  if (!trackingState.desiredEnabled || runtimeProfileState.mode === 'audio_only') {
    if (!trackingState.fallbackMode) applyTrackingFallback('disabled');
    return;
  }

  if (!box) {
    if (trackingState.lastSeenTs && now - trackingState.lastSeenTs > trackingConfig.lostFaceMs) {
      applyTrackingFallback('face_lost');
      avatarState.faceBox = null;
      avatarState.autoFaceRegions = null;
    }
    trackingState.status = trackingState.lastSeenTs ? 'reacquiring' : 'face_lost';
    return;
  }

  const regions = detectFaceRegionsFromDrawing(box);
  const coverage = (box.w * box.h) / (drawCanvas.width * drawCanvas.height);
  const confidence = clamp(coverage * 5, 0, 1);
  trackingState.confidence = confidence;
  if (confidence < trackingConfig.minConfidence) {
    trackingState.status = 'reacquiring';
    return;
  }

  trackingState.enabled = true;
  trackingState.status = 'tracking';
  trackingState.fallbackMode = false;
  const dt = Math.max(1 / trackingConfig.fps, trackingState.lastSeenTs ? (now - trackingState.lastSeenTs) / 1000 : 1 / trackingConfig.fps);
  if (trackingState.lastSeenTs) {
    const expectedFrameMs = 1000 / trackingConfig.fps;
    const dropped = Math.max(0, Math.round((now - trackingState.lastSeenTs) / expectedFrameMs) - 1);
    trackingState.diagnostics.dropFrames += dropped;
  }
  trackingState.lastSeenTs = now;
  const rawPose = estimatePoseFromFace(box);
  trackingState.pose = {
    yaw: adaptiveSmooth(rawPose.yaw, trackingState.pose.yaw, rawPose.yaw - trackingState.pose.yaw, dt, confidence),
    pitch: adaptiveSmooth(rawPose.pitch, trackingState.pose.pitch, rawPose.pitch - trackingState.pose.pitch, dt, confidence),
    roll: adaptiveSmooth(rawPose.roll, trackingState.pose.roll, rawPose.roll - trackingState.pose.roll, dt, confidence),
  };
  const rawLandmarks = collectTrackingLandmarks(box, regions, drawCanvas.width, drawCanvas.height);
  let frameJitter = 0;
  let frameOutliers = 0;
  const nextLandmarks = rawLandmarks.map((entry) => {
    const prev = trackingState.filtered.get(entry.key);
    const smoothed = smoothLandmarkEntry(entry, prev, dt, confidence);
    const { entry: clampedEntry, rejected } = clampLandmarkMovement(smoothed, prev);
    if (rejected) frameOutliers += 1;
    const currentFlat = flattenLandmarkValues(clampedEntry);
    const prevFlat = flattenLandmarkValues(prev);
    if (currentFlat.length === prevFlat.length && currentFlat.length > 0) {
      const meanDelta = currentFlat.reduce((acc, value, idx) => acc + Math.abs(value - prevFlat[idx]), 0) / currentFlat.length;
      frameJitter += meanDelta;
    }
    trackingState.filtered.set(entry.key, clampedEntry);
    return clampedEntry;
  });
  trackingState.landmarks = nextLandmarks;
  trackingState.diagnostics.outlierRejects += frameOutliers;
  trackingState.diagnostics.jitterScore = smooth(trackingState.diagnostics.jitterScore, frameJitter, 0.2);
  avatarState.faceBox = box;
  avatarState.autoFaceRegions = regions;
}

function startFaceTracking() {
  if (trackingLoopId) return;
  const frameInterval = 1000 / trackingConfig.fps;
  let lastTick = 0;
  const loop = (ts) => {
    if (!lastTick || ts - lastTick >= frameInterval) {
      lastTick = ts;
      analyzeTrackingFrame(ts);
    }
    trackingLoopId = requestAnimationFrame(loop);
  };
  trackingLoopId = requestAnimationFrame(loop);
}

function stopFaceTracking() {
  if (trackingLoopId) cancelAnimationFrame(trackingLoopId);
  trackingLoopId = undefined;
  applyTrackingFallback();
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
    const expressionState = deriveExpressionState(audioState.featureState, audioState.expressionTiming, runtimeProfileState.profile);
    const faceState = blendFaceState(targetVisemes, expressionState, landmarkExpressionState, trackingState);
    audioState.expressionState = expressionState;
    audioState.visemeWeights = smoothVisemeWeights(audioState.visemeWeights, faceState.visemeWeights, latency, audioState);

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
  audioState.expressionState = { intensity: 0, eyeLift: 0, browLift: 0, headTilt: 0, mouthCorner: 0 };
  audioState.expressionTiming = {
    phase: 'idle',
    peak: 0,
    holdUntil: 0,
    hitUntil: 0,
    releaseUntil: 0,
    cooldownUntil: 0,
    microFreezeFrames: 0,
    prevVoiced: false,
  };
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
  const profile = getResolvedProfileParams();
  const sens = clamp(sensitivity * profile.visemeSensitivity, 0.6, 2.6);
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



function deriveExpressionState(audioFeatures, timingState, mode = 'natural') {
  const features = audioFeatures || {};
  const energy = features.energy || 0;
  const highBand = features.highBand || 0;
  const zeroCrossNorm = features.zeroCrossNorm || 0;
  const bright = clamp(highBand * 0.62 + (features.centroidNorm || 0) * 0.38, 0, 1);
  const stableLow = clamp((features.lowBand || 0) * 0.7 + energy * 0.3, 0, 1);
  const rawIntensity = clamp(energy * 0.58 + bright * 0.42, 0, 1);
  const modeMul = mode === 'cartoon' ? 1.2 : mode === 'energetic' ? 1.08 : 1;

  const now = performance.now();
  const voicedSignal = clamp(energy * 0.75 + (features.lowBand || 0) * 0.25, 0, 1);
  const unvoicedSignal = clamp(highBand * 0.62 + zeroCrossNorm * 0.38, 0, 1);
  const confidence = clamp((voicedSignal + unvoicedSignal) * 0.5, 0, 1);
  const isNoisy = confidence < 0.14 || (energy < 0.07 && zeroCrossNorm > 0.88);

  if (isNoisy) {
    timingState.phase = 'idle';
    timingState.peak = smooth(timingState.peak || 0, 0, 0.25);
    timingState.prevVoiced = voicedSignal > 0.22;
    return { intensity: 0, eyeLift: 0, browLift: 0, headTilt: 0, mouthCorner: 0 };
  }

  const prevVoiced = !!timingState.prevVoiced;
  const isVoiced = voicedSignal > 0.22;
  const voicedTransition = isVoiced !== prevVoiced;
  timingState.prevVoiced = isVoiced;

  const riseThreshold = 0.08;
  const isRising = rawIntensity > (timingState.peak || 0) + riseThreshold;
  const hitMs = 80 + Math.round(Math.random() * 60);
  const holdMs = 120 + Math.round(Math.random() * 140);
  const releaseMs = 180;

  if ((isRising || voicedTransition) && now >= (timingState.cooldownUntil || 0)) {
    timingState.phase = 'build';
    timingState.peak = Math.max(rawIntensity, timingState.peak || 0);
  }

  if (timingState.phase === 'build' && rawIntensity >= (timingState.peak || 0) - 0.02) {
    timingState.phase = 'hit';
    timingState.hitUntil = now + hitMs;
    timingState.holdUntil = timingState.hitUntil + holdMs;
    timingState.releaseUntil = timingState.holdUntil + releaseMs;
    timingState.cooldownUntil = timingState.releaseUntil + 70;
    if (mode === 'cartoon') timingState.microFreezeFrames = 1 + Math.round(Math.random());
  }

  if (timingState.phase === 'hit' && now >= (timingState.hitUntil || 0)) timingState.phase = 'hold';
  if (timingState.phase === 'hold' && now >= (timingState.holdUntil || 0)) timingState.phase = 'release';
  if (timingState.phase === 'release' && now >= (timingState.releaseUntil || 0)) timingState.phase = 'idle';

  let phaseGain = 0.55;
  if (timingState.phase === 'build') phaseGain = 0.8;
  else if (timingState.phase === 'hit') phaseGain = 1.25;
  else if (timingState.phase === 'hold') phaseGain = 1.08;
  else if (timingState.phase === 'release') phaseGain = 0.68;

  if ((timingState.microFreezeFrames || 0) > 0) {
    phaseGain = Math.max(phaseGain, 1.2);
    timingState.microFreezeFrames -= 1;
  }

  const targetPeak = Math.max(rawIntensity, timingState.peak || 0);
  timingState.peak = smooth(timingState.peak || 0, targetPeak, timingState.phase === 'release' ? 0.16 : 0.09);

  const intensity = clamp(Math.max(rawIntensity, timingState.peak || 0) * phaseGain * modeMul, 0, 1);
  return {
    intensity,
    eyeLift: clamp((0.18 + bright * 0.72) * intensity, 0, 1),
    browLift: clamp((0.22 + bright * 0.78) * intensity, 0, 1),
    headTilt: clamp((stableLow * 0.55 + energy * 0.45) * intensity, 0, 1),
    mouthCorner: clamp((bright * 0.65 + energy * 0.35) * intensity, 0, 1),
  };
}

function blendFaceState(visemeState, expressionState, landmarkState, tracking) {
  const v = visemeState || { closed: 1, open: 0, wide: 0, round: 0, fv: 0 };
  const e = expressionState || { intensity: 0, eyeLift: 0, browLift: 0, headTilt: 0, mouthCorner: 0 };
  const l = landmarkState || { valid: false, mouth: {}, eyes: {}, brows: {} };
  const trackingValid = !!(tracking?.enabled && !tracking?.fallbackMode && (tracking?.confidence || 0) >= trackingConfig.minConfidence);
  const mouthLandmarkMin = trackingValid ? 0.28 : 0;
  const audioKick = trackingValid ? 0.72 : 1;

  const mouth = normalizeVisemeWeights({
    closed: clamp((v.closed || 0) * audioKick + mouthLandmarkMin * (1 - (l.mouth?.open || 0)), 0, 1),
    open: clamp((v.open || 0) * audioKick + mouthLandmarkMin * (l.mouth?.open || 0), 0, 1),
    wide: clamp((v.wide || 0) * audioKick + mouthLandmarkMin * (l.mouth?.wide || 0), 0, 1),
    round: clamp((v.round || 0) * audioKick + mouthLandmarkMin * (l.mouth?.round || 0), 0, 1),
    fv: clamp((v.fv || 0) * audioKick, 0, 1),
  });

  return {
    visemeWeights: mouth,
    expression: {
      eyeLift: clamp((e.eyeLift || 0) * 0.6 + (l.eyes?.openness || 0) * 0.4, 0, 1),
      browLift: clamp((e.browLift || 0) * 0.6 + (l.brows?.lift || 0) * 0.4, 0, 1),
      headTilt: e.headTilt || 0,
      mouthCorner: clamp((e.mouthCorner || 0) * 0.6 + Math.max(0, l.mouth?.corners || 0) * 0.4, 0, 1),
      intensity: e.intensity || 0,
    },
  };
}

function deriveLandmarkExpressionState() {
  const empty = { valid: false, mouth: { open: 0, wide: 0, round: 0, corners: 0 }, eyes: { openness: 0, squeeze: 0 }, brows: { lift: 0, frown: 0 } };
  const mouth = getPreferredRegion('mouth');
  const leftEye = getPreferredRegion('leftEye');
  const rightEye = getPreferredRegion('rightEye');
  const brows = getPreferredRegion('brows');
  if (!mouth || !leftEye || !rightEye || !brows) return empty;
  const mb = getRegionBounds(mouth); const lb = getRegionBounds(leftEye); const rb = getRegionBounds(rightEye); const bb = getRegionBounds(brows);
  if (!mb || !lb || !rb || !bb) return empty;
  const mouthOpen = clamp((mb.h / Math.max(mb.w, 1) - 0.16) * 2.6, 0, 1);
  const mouthWide = clamp((mb.w / Math.max(mb.h, 1) - 1.8) * 0.45, 0, 1);
  const mouthRound = clamp((1.15 - mb.w / Math.max(mb.h, 1)) * 0.7, 0, 1);
  const eyeOpen = clamp((((lb.h / Math.max(lb.w,1)) + (rb.h / Math.max(rb.w,1))) * 0.5 - 0.22) * 3, 0, 1);
  const browLift = clamp(((lb.y + rb.y) * 0.5 - bb.y) / Math.max(mb.h * 1.6, 1), 0, 1);
  return { valid: true, mouth: { open: mouthOpen, wide: mouthWide, round: mouthRound, corners: mouthWide - mouthRound }, eyes: { openness: eyeOpen, squeeze: 1-eyeOpen }, brows: { lift: browLift, frown: clamp(1-browLift,0,1) } };
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
  const profile = getResolvedProfileParams();
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
    boostedTarget.fv = clamp(boostedTarget.fv + tuning.transientBoost.fvBoost * profile.transientBoostMul, 0, 1);
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
    const attack = (tuning.visemeSmoothing.attackBase - latency * tuning.visemeSmoothing.latencyAttackFactor) * (visemeTuning.attackMul || 1) * profile.visemeSmoothingAttackMul;
    const release = (tuning.visemeSmoothing.releaseBase - latency * tuning.visemeSmoothing.latencyReleaseFactor) * (visemeTuning.releaseMul || 1) * profile.visemeSmoothingReleaseMul;
    const alpha = desired > prev ? attack : release;
    next[key] = smooth(prev, desired, clamp(alpha, tuning.visemeSmoothing.alphaClamp.min, tuning.visemeSmoothing.alphaClamp.max));
  });
  return normalizeVisemeWeights(next);
}

function renderOutput() {
  outputCtx.clearRect(0, 0, outputCanvas.width, outputCanvas.height);

  if (avatarState.baseFrame) {
    const nextLandmarkState = deriveLandmarkExpressionState();
    Object.assign(landmarkExpressionState, nextLandmarkState);
    outputCtx.putImageData(avatarState.baseFrame, 0, 0);

    if (avatarState.faceBox) {
      const mouthRegion = resolveMouthRegion(avatarState.faceBox);
      animateMouthFromRegion(mouthRegion, audioState.visemeWeights, landmarkExpressionState);
      animateEyeAndBrowRegions(avatarState.faceBox, landmarkExpressionState);
    }

    if (avatarState.faceBox && audioState.level > 0.04) {
      animateHeadBounce(avatarState.faceBox, audioState.level, audioState.featureState, audioState.pitchHz, audioState.expressionState);
      if (motionState.enabled) {
        animateExpressionRegions(avatarState.faceBox, audioState.featureState, audioState.pitchHz, audioState.expressionState);
      }
    }
  }

  drawDebugOverlay();
  updateTrackingStatusMessage();
  renderId = requestAnimationFrame(renderOutput);
}

function animateMouthFromRegion(mouthRegion, visemeWeights, landmarkState) {
  if (!mouthRegion) return;
  const bounds = getRegionBounds(mouthRegion);
  if (!bounds) return;
  const srcAnchors = buildMouthAnchors(bounds);
  const dstAnchors = deformMouthAnchors(srcAnchors, bounds, visemeWeights, landmarkState);

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

function animateEyeAndBrowRegions(faceBox, landmarkState) {
  if (!faceBox || !landmarkState?.valid) return;
  const deformRegion = (region, dx, dy) => {
    if (!region) return;
    const b = getRegionBounds(region); if (!b) return;
    outputCtx.save(); traceRegionPath(outputCtx, region); outputCtx.clip();
    outputCtx.drawImage(outputCanvas, b.x, b.y, b.w, b.h, b.x + dx, b.y + dy, b.w, b.h);
    outputCtx.restore();
  };
  const eyeOffset = (0.5 - (landmarkState.eyes?.openness || 0.5)) * faceBox.h * 0.015;
  const browOffset = -((landmarkState.brows?.lift || 0) * faceBox.h * 0.02);
  deformRegion(getPreferredRegion('leftEye'), 0, eyeOffset);
  deformRegion(getPreferredRegion('rightEye'), 0, eyeOffset);
  deformRegion(getPreferredRegion('brows'), 0, browOffset);
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

function deformMouthAnchors(anchors, bounds, visemeWeights, landmarkState) {
  const profile = getResolvedProfileParams();
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

  const lm = landmarkState?.valid ? landmarkState.mouth : { open: 0, wide: 0, round: 0, corners: 0 };
  const weights = { closed, open: clamp(open + lm.open * 0.45,0,1), wide: clamp(wide + lm.wide * 0.4,0,1), round: clamp(round + lm.round * 0.32,0,1), fv };
  Object.entries(visemeProfiles).forEach(([key, profile]) => {
    if (!deformed[key]) return;
    const base = anchors[key];
    const dx = Object.entries(profile.dx).reduce((sum, [viseme, factor]) => sum + weights[viseme] * factor, 0) * profileStateMouthMul();
    const dy = Object.entries(profile.dy).reduce((sum, [viseme, factor]) => sum + weights[viseme] * factor, 0) * profileStateMouthMul();
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

function animateHeadBounce(faceBox, level, features = {}, pitchHz = 0, expressionState = {}) {
  const profile = getResolvedProfileParams();
  const { x, y, w, h } = faceBox;
  const energy = features.energy || level || 0;
  const lowBand = features.lowBand || 0;
  const centroidNorm = features.centroidNorm || 0;
  const pitchBoost = clamp((pitchHz - 180) / 420, 0, 1);
  const brightBoost = clamp((centroidNorm - 0.35) * 0.5 + pitchBoost * 0.25, 0, 0.42);
  const expressionTilt = expressionState?.headTilt || 0;
  const dynamics = (1 + brightBoost + expressionTilt * 0.25) * profile.headMotionMul;

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

function bindProfileControls() {
  profileSelect?.addEventListener('change', () => {
    runtimeProfileState.profile = profileSelect.value in ANIMATION_PROFILES ? profileSelect.value : 'natural';
    persistProfileSettings();
  });
  responsivenessInput?.addEventListener('input', () => {
    runtimeProfileState.responsiveness = clamp(Number(responsivenessInput.value || 0.5), 0, 1);
    persistProfileSettings();
  });
  expressivenessInput?.addEventListener('input', () => {
    runtimeProfileState.expressiveness = clamp(Number(expressivenessInput.value || 0.5), 0, 1);
    persistProfileSettings();
  });
  trackingSmoothnessInput?.addEventListener('input', () => {
    trackingConfig.trackingSmoothness = clamp(Number(trackingSmoothnessInput.value || 0.55), 0, 1);
    persistProfileSettings();
  });
  trackingResponsivenessInput?.addEventListener('input', () => {
    trackingConfig.trackingResponsiveness = clamp(Number(trackingResponsivenessInput.value || 0.5), 0, 1);
    persistProfileSettings();
  });
}

function hydrateProfileSettings() {
  const storedProfile = localStorage.getItem(STORAGE_KEYS.profile);
  runtimeProfileState.profile = storedProfile in ANIMATION_PROFILES ? storedProfile : 'natural';
  runtimeProfileState.responsiveness = clamp(Number(localStorage.getItem(STORAGE_KEYS.responsiveness) || 0.5), 0, 1);
  runtimeProfileState.expressiveness = clamp(Number(localStorage.getItem(STORAGE_KEYS.expressiveness) || 0.5), 0, 1);
  trackingConfig.trackingSmoothness = clamp(Number(localStorage.getItem(STORAGE_KEYS.trackingSmoothness) || trackingConfig.trackingSmoothness), 0, 1);
  trackingConfig.trackingResponsiveness = clamp(Number(localStorage.getItem(STORAGE_KEYS.trackingResponsiveness) || trackingConfig.trackingResponsiveness), 0, 1);
  trackingState.desiredEnabled = localStorage.getItem(STORAGE_KEYS.trackingEnabled) !== 'false';
  runtimeProfileState.mode = localStorage.getItem(STORAGE_KEYS.mode) || 'tracking_audio';
  const debugOverlayEnabled = localStorage.getItem(STORAGE_KEYS.debugOverlay) === 'true';
  if (profileSelect) profileSelect.value = runtimeProfileState.profile;
  if (responsivenessInput) responsivenessInput.value = String(runtimeProfileState.responsiveness);
  if (expressivenessInput) expressivenessInput.value = String(runtimeProfileState.expressiveness);
  if (trackingSmoothnessInput) trackingSmoothnessInput.value = String(trackingConfig.trackingSmoothness);
  if (trackingResponsivenessInput) trackingResponsivenessInput.value = String(trackingConfig.trackingResponsiveness);
  if (modeSelect) modeSelect.value = runtimeProfileState.mode;
  if (debugOverlayToggle) debugOverlayToggle.checked = debugOverlayEnabled;
  trackingState.debugOverlay = debugOverlayEnabled;
  if (trackingToggleBtn) trackingToggleBtn.textContent = `Face Tracking: ${trackingState.desiredEnabled ? 'On' : 'Off'}`;
}

function persistProfileSettings() {
  localStorage.setItem(STORAGE_KEYS.profile, runtimeProfileState.profile);
  localStorage.setItem(STORAGE_KEYS.responsiveness, String(runtimeProfileState.responsiveness));
  localStorage.setItem(STORAGE_KEYS.expressiveness, String(runtimeProfileState.expressiveness));
  localStorage.setItem(STORAGE_KEYS.trackingSmoothness, String(trackingConfig.trackingSmoothness));
  localStorage.setItem(STORAGE_KEYS.trackingResponsiveness, String(trackingConfig.trackingResponsiveness));
  localStorage.setItem(STORAGE_KEYS.trackingEnabled, String(trackingState.desiredEnabled));
  localStorage.setItem(STORAGE_KEYS.mode, runtimeProfileState.mode);
  localStorage.setItem(STORAGE_KEYS.debugOverlay, String(!!trackingState.debugOverlay));
}

function getResolvedProfileParams() {
  const base = ANIMATION_PROFILES[runtimeProfileState.profile] || ANIMATION_PROFILES.natural;
  const responsivenessBoost = 0.75 + runtimeProfileState.responsiveness * 0.6;
  const expressivenessBoost = 0.75 + runtimeProfileState.expressiveness * 0.7;
  return {
    visemeSensitivity: base.visemeSensitivity * expressivenessBoost,
    visemeSmoothingAttackMul: base.visemeSmoothingAttackMul * responsivenessBoost,
    visemeSmoothingReleaseMul: base.visemeSmoothingReleaseMul * (0.85 + runtimeProfileState.responsiveness * 0.4),
    headMotionMul: base.headMotionMul * expressivenessBoost,
    mouthDeformMul: base.mouthDeformMul * expressivenessBoost,
    transientBoostMul: base.transientBoostMul * (0.85 + runtimeProfileState.responsiveness * 0.5),
  };
}

function profileStateMouthMul() {
  return getResolvedProfileParams().mouthDeformMul;
}

function animateExpressionRegions(faceBox, features = {}, pitchHz = 0, expressionState = {}) {
  const expressionBoost = expressionState?.intensity || 0;
  const emphasis = clamp((features.energy || 0) * 0.45 + (features.highBand || 0) * 0.25 + (features.centroidNorm || 0) * 0.12 + expressionBoost * 0.32, 0, 1);
  if (emphasis < 0.08) return;

  const brightBoost = clamp((features.centroidNorm || 0) * 0.6 + clamp((pitchHz - 200) / 350, 0, 1) * 0.4, 0, 1);
  const eyeShift = -(0.006 + brightBoost * 0.01 + (expressionState?.eyeLift || 0) * 0.006) * emphasis;
  const browShift = -(0.012 + brightBoost * 0.018 + (expressionState?.browLift || 0) * 0.01) * emphasis;

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

function bindTrackingControls() {
  trackingToggleBtn?.addEventListener('click', () => {
    trackingState.desiredEnabled = !trackingState.desiredEnabled;
    trackingToggleBtn.textContent = `Face Tracking: ${trackingState.desiredEnabled ? 'On' : 'Off'}`;
    if (!trackingState.desiredEnabled) applyTrackingFallback('disabled');
    persistProfileSettings();
  });
  modeSelect?.addEventListener('change', () => {
    runtimeProfileState.mode = modeSelect.value === 'audio_only' ? 'audio_only' : 'tracking_audio';
    if (runtimeProfileState.mode === 'audio_only') applyTrackingFallback('disabled');
    persistProfileSettings();
  });
  debugOverlayToggle?.addEventListener('change', () => {
    trackingState.debugOverlay = debugOverlayToggle.checked;
    persistProfileSettings();
  });
}

function drawDebugOverlay() {
  if (!trackingState.debugOverlay) return;
  outputCtx.save();
  outputCtx.fillStyle = 'rgba(2, 6, 23, 0.72)';
  outputCtx.fillRect(12, 12, 320, 130);
  outputCtx.fillStyle = '#e2e8f0';
  outputCtx.font = '13px monospace';
  const vw = audioState.visemeWeights || {};
  const lines = [
    `Confidence: ${(trackingState.confidence || 0).toFixed(2)}`,
    `Status: ${trackingState.status || 'idle'}`,
    `Blend: c:${(vw.closed||0).toFixed(2)} o:${(vw.open||0).toFixed(2)} w:${(vw.wide||0).toFixed(2)} r:${(vw.round||0).toFixed(2)} fv:${(vw.fv||0).toFixed(2)}`
  ];
  lines.forEach((line, i) => outputCtx.fillText(line, 20, 34 + i * 20));
  outputCtx.fillStyle = '#22d3ee';
  trackingState.landmarks?.forEach((lm) => {
    if (lm.type === 'rect' && lm.rect) {
      const x = lm.rect.x * outputCanvas.width;
      const y = lm.rect.y * outputCanvas.height;
      const w = lm.rect.w * outputCanvas.width;
      const h = lm.rect.h * outputCanvas.height;
      outputCtx.strokeRect(x, y, w, h);
    }
    if (lm.type === 'polygon' && lm.points?.length) {
      lm.points.forEach((pt) => {
        outputCtx.beginPath();
        outputCtx.arc(pt.x * outputCanvas.width, pt.y * outputCanvas.height, 2.5, 0, Math.PI * 2);
        outputCtx.fill();
      });
    }
  });
  outputCtx.restore();
}

function updateTrackingStatusMessage() {
  if (regionEditState.active) return;
  if (!trackingState.desiredEnabled || runtimeProfileState.mode === 'audio_only') {
    setStatus('Tracking deaktiviert (Audio only).');
    return;
  }
  if (trackingState.status === 'tracking') setStatus(`Tracking aktiv (Confidence ${(trackingState.confidence || 0).toFixed(2)}).`);
  else if (trackingState.status === 'reacquiring') setStatus('Reacquiring face...');
  else if (trackingState.status === 'face_lost') setStatus('Face lost. Bitte frontal ins Bild.');
}
