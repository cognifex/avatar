const drawCanvas = document.getElementById('drawCanvas');
const drawGuideCanvas = document.getElementById('drawGuideCanvas');
const outputCanvas = document.getElementById('outputCanvas');

const brushSizeInput = document.getElementById('brushSize');
const clearBtn = document.getElementById('clearBtn');
const detectBtn = document.getElementById('detectBtn');
const copyBtn = document.getElementById('copyBtn');
const micBtn = document.getElementById('micBtn');
const stopMicBtn = document.getElementById('stopMicBtn');
const regionSelect = document.getElementById('regionSelect');
const drawRegionBtn = document.getElementById('drawRegionBtn');
const adoptRegionBtn = document.getElementById('adoptRegionBtn');
const resetRegionBtn = document.getElementById('resetRegionBtn');
const statusEl = document.getElementById('status');
const transparentBg = document.getElementById('transparentBg');
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
  mouthOpen: 0,
};

const avatarState = {
  faceBox: null,
  autoFaceRegions: null,
  faceRegions: {},
  baseFrame: null,
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

  const loop = () => {
    analyser.getFloatTimeDomainData(timeData);

    const rms = Math.sqrt(timeData.reduce((acc, v) => acc + v * v, 0) / timeData.length);
    audioState.level = smooth(audioState.level, rms, 0.25);

    const pitch = estimatePitch(timeData, audioCtx.sampleRate);
    audioState.pitchHz = smooth(audioState.pitchHz, pitch, 0.2);

    const pulse = Math.abs(Math.sin(performance.now() / 95));
    audioState.mouthOpen = Math.min(1, audioState.level * 18) * (0.55 + 0.45 * pulse);

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
  audioState.mouthOpen = 0;
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

function renderOutput() {
  outputCtx.clearRect(0, 0, outputCanvas.width, outputCanvas.height);

  if (avatarState.baseFrame) {
    outputCtx.putImageData(avatarState.baseFrame, 0, 0);

    if (avatarState.faceBox && audioState.mouthOpen > 0.01) {
      const mouthRegion = resolveMouthRegion(avatarState.faceBox);
      const visemeState = classifyVisemeState(audioState.mouthOpen, audioState.pitchHz);
      animateMouthFromRegion(mouthRegion, visemeState);
    }

    if (avatarState.faceBox && audioState.level > 0.08) {
      animateHeadBounce(avatarState.faceBox, audioState.level);
    }
  }

  renderId = requestAnimationFrame(renderOutput);
}

function animateMouthFromRegion(mouthRegion, visemeState) {
  if (!mouthRegion) return;
  const bounds = getRegionBounds(mouthRegion);
  if (!bounds) return;
  const srcAnchors = buildMouthAnchors(bounds);
  const dstAnchors = deformMouthAnchors(srcAnchors, bounds, visemeState);

  bufferCtx.clearRect(0, 0, bufferCanvas.width, bufferCanvas.height);
  bufferCtx.drawImage(outputCanvas, 0, 0);

  outputCtx.save();
  traceRegionPath(outputCtx, mouthRegion);
  outputCtx.clip();
  outputCtx.clearRect(bounds.x - 2, bounds.y - 2, bounds.w + 4, bounds.h + 4);

  const triangles = [
    ['tl', 'upperMid', 'leftCorner'],
    ['tl', 'tr', 'upperMid'],
    ['tr', 'rightCorner', 'upperMid'],
    ['tr', 'br', 'rightCorner'],
    ['br', 'lowerMid', 'rightCorner'],
    ['br', 'bl', 'lowerMid'],
    ['bl', 'leftCorner', 'lowerMid'],
    ['bl', 'tl', 'leftCorner'],
    ['leftCorner', 'upperMid', 'center'],
    ['upperMid', 'rightCorner', 'center'],
    ['rightCorner', 'lowerMid', 'center'],
    ['lowerMid', 'leftCorner', 'center'],
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

function classifyVisemeState(mouthOpen, pitchHz) {
  if (mouthOpen < 0.12) return 'Closed';
  if (mouthOpen < 0.3) return 'Open';
  if (pitchHz > 210) return 'Wide';
  if (pitchHz > 0 && pitchHz < 150) return 'Round';
  return 'Open';
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
    upperMid: { x: x + w * 0.5, y: y + h * 0.42 },
    lowerMid: { x: x + w * 0.5, y: y + h * 0.72 },
    center: { x: x + w * 0.5, y: y + h * 0.57 },
  };
}

function deformMouthAnchors(anchors, bounds, visemeState) {
  const deformed = Object.fromEntries(
    Object.entries(anchors).map(([key, point]) => [key, { x: point.x, y: point.y }]),
  );
  const { w, h } = bounds;

  if (visemeState === 'Closed') {
    deformed.leftCorner.x += w * 0.03;
    deformed.rightCorner.x -= w * 0.03;
    deformed.upperMid.y += h * 0.06;
    deformed.lowerMid.y -= h * 0.1;
  } else if (visemeState === 'Wide') {
    deformed.leftCorner.x -= w * 0.11;
    deformed.rightCorner.x += w * 0.11;
    deformed.upperMid.y -= h * 0.04;
    deformed.lowerMid.y += h * 0.1;
  } else if (visemeState === 'Round') {
    deformed.leftCorner.x += w * 0.09;
    deformed.rightCorner.x -= w * 0.09;
    deformed.upperMid.y -= h * 0.02;
    deformed.lowerMid.y += h * 0.12;
  } else {
    deformed.upperMid.y -= h * 0.09;
    deformed.lowerMid.y += h * 0.2;
  }

  deformed.center.x = (deformed.leftCorner.x + deformed.rightCorner.x) / 2;
  deformed.center.y = (deformed.upperMid.y + deformed.lowerMid.y) / 2;
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

function animateHeadBounce(faceBox, level) {
  const { x, y, w, h } = faceBox;
  const amp = Math.min(6, level * 60);
  const offsetY = Math.sin(performance.now() / 70) * amp;

  bufferCtx.clearRect(0, 0, bufferCanvas.width, bufferCanvas.height);
  bufferCtx.drawImage(outputCanvas, 0, 0);

  outputCtx.clearRect(x - 2, y - 2, w + 4, h + 4);
  outputCtx.drawImage(bufferCanvas, x, y, w, h, x, y + offsetY, w, h);
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
