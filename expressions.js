const expressionPresets = Object.freeze({
  neutral: {
    eyes: { shape: 0, openness: 0, tilt: 0 },
    brows: { height: 0, angle: 0, asymmetry: 0 },
    mouthBias: { open: 0, wide: 0, round: 0, corners: 0 },
    headPose: { tilt: 0, nodBias: 0 },
    meta: {
      intensityRange: [0, 0.35],
      holdMs: 80,
      cooldownMs: 40,
      compatibility: ['closed', 'open', 'wide', 'round', 'fv'],
    },
  },
  deadpan: {
    eyes: { shape: -0.1, openness: -0.22, tilt: 0 },
    brows: { height: -0.06, angle: -0.02, asymmetry: 0 },
    mouthBias: { open: -0.18, wide: -0.08, round: -0.08, corners: -0.04 },
    headPose: { tilt: 0, nodBias: -0.03 },
    meta: {
      intensityRange: [0.2, 0.75],
      holdMs: 150,
      cooldownMs: 90,
      compatibility: ['closed', 'fv'],
    },
  },
  smug: {
    eyes: { shape: 0.05, openness: -0.1, tilt: 0.16 },
    brows: { height: 0.08, angle: 0.14, asymmetry: 0.32 },
    mouthBias: { open: -0.05, wide: 0.18, round: -0.14, corners: 0.24 },
    headPose: { tilt: 0.1, nodBias: -0.02 },
    meta: {
      intensityRange: [0.25, 0.85],
      holdMs: 180,
      cooldownMs: 100,
      compatibility: ['closed', 'wide', 'fv'],
    },
  },
  rage: {
    eyes: { shape: -0.26, openness: 0.3, tilt: -0.2 },
    brows: { height: -0.3, angle: -0.5, asymmetry: 0.08 },
    mouthBias: { open: 0.32, wide: 0.18, round: -0.2, corners: -0.26 },
    headPose: { tilt: -0.06, nodBias: 0.24 },
    meta: {
      intensityRange: [0.55, 1],
      holdMs: 120,
      cooldownMs: 150,
      compatibility: ['open', 'wide'],
    },
  },
  panic: {
    eyes: { shape: 0.24, openness: 0.44, tilt: 0.04 },
    brows: { height: 0.34, angle: 0.24, asymmetry: 0.14 },
    mouthBias: { open: 0.38, wide: -0.06, round: 0.24, corners: -0.08 },
    headPose: { tilt: 0.04, nodBias: 0.16 },
    meta: {
      intensityRange: [0.45, 1],
      holdMs: 90,
      cooldownMs: 140,
      compatibility: ['open', 'round'],
    },
  },
  confused: {
    eyes: { shape: 0.04, openness: 0.02, tilt: -0.08 },
    brows: { height: 0.12, angle: 0.1, asymmetry: 0.42 },
    mouthBias: { open: 0.04, wide: -0.12, round: 0.08, corners: -0.02 },
    headPose: { tilt: 0.14, nodBias: -0.06 },
    meta: {
      intensityRange: [0.2, 0.7],
      holdMs: 170,
      cooldownMs: 120,
      compatibility: ['closed', 'round', 'fv'],
    },
  },
  joy: {
    eyes: { shape: 0.1, openness: -0.04, tilt: 0.1 },
    brows: { height: 0.18, angle: 0.08, asymmetry: 0.06 },
    mouthBias: { open: 0.08, wide: 0.36, round: -0.14, corners: 0.34 },
    headPose: { tilt: 0.06, nodBias: 0.08 },
    meta: {
      intensityRange: [0.3, 1],
      holdMs: 140,
      cooldownMs: 80,
      compatibility: ['open', 'wide'],
    },
  },
  sad: {
    eyes: { shape: -0.12, openness: -0.1, tilt: -0.1 },
    brows: { height: -0.12, angle: 0.18, asymmetry: 0.1 },
    mouthBias: { open: -0.06, wide: -0.18, round: 0.02, corners: -0.32 },
    headPose: { tilt: -0.04, nodBias: -0.18 },
    meta: {
      intensityRange: [0.2, 0.9],
      holdMs: 240,
      cooldownMs: 110,
      compatibility: ['closed', 'round'],
    },
  },
  skeptical: {
    eyes: { shape: -0.02, openness: -0.12, tilt: 0.12 },
    brows: { height: 0.04, angle: 0.12, asymmetry: 0.48 },
    mouthBias: { open: -0.1, wide: 0.06, round: -0.08, corners: 0.09 },
    headPose: { tilt: 0.12, nodBias: -0.04 },
    meta: {
      intensityRange: [0.2, 0.78],
      holdMs: 200,
      cooldownMs: 100,
      compatibility: ['closed', 'wide', 'fv'],
    },
  },
  awe: {
    eyes: { shape: 0.2, openness: 0.36, tilt: 0.02 },
    brows: { height: 0.28, angle: 0.12, asymmetry: 0.05 },
    mouthBias: { open: 0.26, wide: -0.08, round: 0.34, corners: 0.04 },
    headPose: { tilt: 0, nodBias: 0.12 },
    meta: {
      intensityRange: [0.35, 0.95],
      holdMs: 130,
      cooldownMs: 130,
      compatibility: ['open', 'round'],
    },
  },
});

window.expressionPresets = expressionPresets;
