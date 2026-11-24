import type { Buffer, MeshPlane } from 'pixi.js';

export interface RigPoint {
  readonly x: number;
  readonly y: number;
}

export interface EarRig {
  readonly id: string;
  /** Skull attachment point used as rotation pivot (normalised 0-1). */
  readonly base: RigPoint;
  /** Outer ear tip (normalised 0-1). */
  readonly tip: RigPoint;
  /** Smooth influence radius around the ear centre (normalised 0-1). */
  readonly radius: number;
}

export interface CatRigData {
  /** Torso / ribcage centre for breathing expansion & stretch origin (normalised 0-1). */
  readonly bodyCenter: RigPoint;
  /** Approximate torso breathing radius (normalised 0-1). */
  readonly bodyRadius: number;
  /** Head centre for breathing suppression & hand-proximity ear twitch (normalised 0-1). */
  readonly head: RigPoint;
  /** Approximate head radius (normalised 0-1). */
  readonly headRadius: number;
  /** Each visible ear on the cut-out. */
  readonly ears: readonly EarRig[];
  /** Tail polyline (6-8 points) ordered from base (index 0) to tip (last index). */
  readonly tail: readonly RigPoint[];
  /** Half-width smooth falloff radius around the tail polyline (normalised 0-1). */
  readonly tailRadius: number;
  /** Optional spine / back polyline (shoulders to rump) for skin-twitch ripple. */
  readonly back?: readonly RigPoint[];
}

export type RigAction =
  | 'earTwitch'
  | 'tailHappy'
  | 'tailAnnoyed'
  | 'skinTwitch'
  | 'stretch';

export type RigMood = 'calm' | 'happy' | 'annoyed';

export interface RigUvRect {
  readonly u0: number;
  readonly v0: number;
  readonly uSpan: number;
  readonly vSpan: number;
}

export interface RigUpdateInput {
  /** Distance from pointer/hand fingertip to the cat's head in CSS pixels, or null when hand is absent. */
  readonly handDistToHeadPx?: number | null;
}

export interface RigDebugState {
  readonly mood: RigMood;
  readonly reducedMotion: boolean;
  readonly bodyCenter: RigPoint;
  readonly bodyRadius: number;
  readonly head: RigPoint;
  readonly headRadius: number;
  readonly ears: readonly {
    readonly id: string;
    readonly base: RigPoint;
    readonly tip: RigPoint;
    readonly radius: number;
    readonly angleDeg: number;
  }[];
  readonly tail: readonly RigPoint[];
  readonly back: readonly RigPoint[];
  readonly breathScale: number;
  readonly tailAngleDeg: number;
  readonly stretchAmount: number;
  readonly skinTwitchProgress: number;
}

interface EarVertexBinding {
  readonly earIndex: number;
  readonly pivotX: number;
  readonly pivotY: number;
  readonly count: number;
  readonly indices: Uint16Array;
  readonly relX: Float32Array;
  readonly relY: Float32Array;
  readonly weights: Float32Array;
}

interface TailVertexBinding {
  readonly count: number;
  readonly indices: Uint16Array;
  readonly segIndices: Uint8Array;
  readonly segT: Float32Array;
  readonly offsetX: Float32Array;
  readonly offsetY: Float32Array;
  readonly restU: Float32Array;
  readonly restV: Float32Array;
  readonly weights: Float32Array;
}

interface BackVertexBinding {
  readonly count: number;
  readonly indices: Uint16Array;
  readonly spineS: Float32Array;
  readonly normalX: Float32Array;
  readonly normalY: Float32Array;
  readonly weights: Float32Array;
}

export interface CatRigMeshBinding {
  readonly mesh: MeshPlane;
  readonly verticesX: number;
  readonly verticesY: number;
  readonly vertexCount: number;
  readonly positionBuffer: Buffer;
  readonly positions: Float32Array;
  readonly restX: Float32Array;
  readonly restY: Float32Array;
  readonly pxPerU: number;
  readonly pxPerV: number;
  /** Pre-scaled breathing displacement vectors (in local mesh pixels per unit breath wave). */
  readonly breathPxX: Float32Array;
  readonly breathPxY: Float32Array;
  /** Pre-scaled stretch displacement vectors (in local mesh pixels at stretchAmount = 1). */
  readonly stretchPxX: Float32Array;
  readonly stretchPxY: Float32Array;
  readonly earBindings: readonly EarVertexBinding[];
  readonly tailBinding: TailVertexBinding;
  readonly backBinding: BackVertexBinding;
}

interface EarState {
  active: boolean;
  elapsed: number;
  flickCount: 1 | 2;
  sign: 1 | -1;
  angleRad: number;
}

interface PolylineProjection {
  segIndex: number;
  segT: number;
  closestX: number;
  closestY: number;
  dist: number;
  s: number;
  normalX: number;
  normalY: number;
}

interface PolylineMetrics {
  readonly points: readonly RigPoint[];
  readonly segDx: Float32Array;
  readonly segDy: Float32Array;
  readonly segLen: Float32Array;
  readonly cumLen: Float32Array;
  readonly jointS: Float32Array;
  readonly totalLen: number;
}

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const TWO_PI = Math.PI * 2;

// Ear twitch timing (120 ms quick flick, once or twice; random 8-20 s; ~80 px hand proximity)
const EAR_FLICK_DURATION_SEC = 0.12;
const EAR_DOUBLE_GAP_SEC = 0.055;
const EAR_FLICK_MAX_RAD = 8 * DEG_TO_RAD;
const EAR_RANDOM_MIN_SEC = 8;
const EAR_RANDOM_MAX_SEC = 20;
const EAR_PROXIMITY_ENTER_PX = 80;
const EAR_PROXIMITY_EXIT_PX = 96;
const EAR_PROXIMITY_COOLDOWN_SEC = 2.4;

// Tail modes (progressive base-to-tip bend)
const TAIL_IDLE_DEG = 2.0;
const TAIL_IDLE_FREQ_HZ = 0.22;
const TAIL_HAPPY_DEG = 6.0;
const TAIL_HAPPY_FREQ_HZ = 0.5;
const TAIL_ANNOYED_IDLE_DEG = 3.5;
const TAIL_ANNOYED_IDLE_FREQ_HZ = 0.85;
const TAIL_HAPPY_BURST_SEC = 3.6;
const TAIL_THUMP_FLICKS = 3;
const TAIL_THUMP_FLICK_SEC = 0.24;
const TAIL_THUMP_TOTAL_SEC = TAIL_THUMP_FLICKS * TAIL_THUMP_FLICK_SEC;
const TAIL_THUMP_MAX_DEG = 12.0;

// Skin twitch (back ripple ~250 ms)
const SKIN_TWITCH_DURATION_SEC = 0.25;
const SKIN_TWITCH_AMP_UV = 0.01;
const SKIN_TWITCH_PACKET_SIGMA = 0.12;
const SKIN_TWITCH_WAVELENGTH = 0.19;

// Stretch along head-tail axis: 1.2 s lengthen -> 0.8 s hold -> 1.4 s relax into melt
const STRETCH_LENGTHEN_SEC = 1.2;
const STRETCH_HOLD_SEC = 0.8;
const STRETCH_RELAX_SEC = 1.4;
const STRETCH_TOTAL_SEC =
  STRETCH_LENGTHEN_SEC + STRETCH_HOLD_SEC + STRETCH_RELAX_SEC;
const STRETCH_AXIS_SCALE = 0.03;
const STRETCH_PERP_SCALE = -0.01;

const DEFAULT_UV_RECT: RigUvRect = { u0: 0, v0: 0, uSpan: 1, vSpan: 1 };

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 === edge0) return x < edge0 ? 0 : 1;
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function buildPolylineMetrics(points: readonly RigPoint[]): PolylineMetrics {
  const count = points.length;
  const segCount = Math.max(0, count - 1);
  const segDx = new Float32Array(segCount);
  const segDy = new Float32Array(segCount);
  const segLen = new Float32Array(segCount);
  const cumLen = new Float32Array(count);
  const jointS = new Float32Array(count);

  let total = 0;
  for (let k = 0; k < segCount; k++) {
    const dx = points[k + 1].x - points[k].x;
    const dy = points[k + 1].y - points[k].y;
    const len = Math.hypot(dx, dy);
    segDx[k] = dx;
    segDy[k] = dy;
    segLen[k] = len;
    total += len;
    cumLen[k + 1] = total;
  }

  const invTotal = total > 1e-6 ? 1 / total : 0;
  for (let j = 0; j < count; j++) {
    jointS[j] = cumLen[j] * invTotal;
  }

  return {
    points,
    segDx,
    segDy,
    segLen,
    cumLen,
    jointS,
    totalLen: total,
  };
}

function projectOntoPolyline(
  u: number,
  v: number,
  poly: PolylineMetrics,
): PolylineProjection {
  const segCount = poly.segLen.length;
  if (segCount === 0) {
    const p = poly.points[0] ?? { x: 0.5, y: 0.5 };
    return {
      segIndex: 0,
      segT: 0,
      closestX: p.x,
      closestY: p.y,
      dist: Math.hypot(u - p.x, v - p.y),
      s: 0,
      normalX: 0,
      normalY: -1,
    };
  }

  let bestDistSq = Infinity;
  let bestSeg = 0;
  let bestT = 0;
  let bestX = poly.points[0].x;
  let bestY = poly.points[0].y;

  for (let k = 0; k < segCount; k++) {
    const p0 = poly.points[k];
    const dx = poly.segDx[k];
    const dy = poly.segDy[k];
    const lenSq = dx * dx + dy * dy;
    let t = 0;
    if (lenSq > 1e-10) {
      t = clamp(((u - p0.x) * dx + (v - p0.y) * dy) / lenSq, 0, 1);
    }
    const cx = p0.x + dx * t;
    const cy = p0.y + dy * t;
    const ex = u - cx;
    const ey = v - cy;
    const distSq = ex * ex + ey * ey;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      bestSeg = k;
      bestT = t;
      bestX = cx;
      bestY = cy;
    }
  }

  // Smoothly interpolate tangent across polyline joints so perpendicular normals have no creases
  const tangentAtJoint = (j: number): [number, number] => {
    const prevK = Math.max(0, j - 1);
    const nextK = Math.min(segCount - 1, j);
    const len0 = poly.segLen[prevK] || 1;
    const len1 = poly.segLen[nextK] || 1;
    const tx = poly.segDx[prevK] / len0 + poly.segDx[nextK] / len1;
    const ty = poly.segDy[prevK] / len0 + poly.segDy[nextK] / len1;
    const tLen = Math.hypot(tx, ty) || 1;
    return [tx / tLen, ty / tLen];
  };

  const [t0x, t0y] = tangentAtJoint(bestSeg);
  const [t1x, t1y] = tangentAtJoint(bestSeg + 1);
  const tx = t0x + (t1x - t0x) * bestT;
  const ty = t0y + (t1y - t0y) * bestT;
  const tLen = Math.hypot(tx, ty) || 1;
  const normalX = -ty / tLen;
  const normalY = tx / tLen;

  const s =
    poly.totalLen > 1e-6
      ? (poly.cumLen[bestSeg] + bestT * poly.segLen[bestSeg]) / poly.totalLen
      : 0;

  return {
    segIndex: bestSeg,
    segT: bestT,
    closestX: bestX,
    closestY: bestY,
    dist: Math.sqrt(bestDistSq),
    s,
    normalX,
    normalY,
  };
}

function buildFallbackBackPolyline(rig: CatRigData): readonly RigPoint[] {
  const tailBase = rig.tail[0] ?? {
    x: rig.bodyCenter.x + 0.2,
    y: rig.bodyCenter.y + 0.15,
  };
  return [rig.head, rig.bodyCenter, tailBase];
}

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/**
 * Real-time 2D vertex rig controller for a living cat MeshPlane.
 *
 * Precomputes smooth per-vertex falloff weights once per bound mesh and combines
 * breathing, ear twitches, progressive tail bends, back skin-twitch ripples, and
 * head-to-tail stretches each frame with zero per-frame allocations.
 */
export class CatRig {
  readonly data: CatRigData;
  private readonly tailPoly: PolylineMetrics;
  private readonly backPoly: PolylineMetrics;
  private readonly headTailAxisX: number;
  private readonly headTailAxisY: number;
  private readonly headTailPerpX: number;
  private readonly headTailPerpY: number;

  private mood: RigMood = 'calm';
  private purrLevel = 0;
  private reducedMotion = false;

  // Breathing state
  private breathPhase = 0;
  private currentBreathFreqHz = 0.42;
  private currentBreathAmp = 0.013;
  private currentBreathScale = 0;

  // Ear twitch state
  private readonly earStates: EarState[];
  private randomEarTimer = randomRange(EAR_RANDOM_MIN_SEC, EAR_RANDOM_MAX_SEC);
  private headProxCooldown = 0;
  private wasNearHead = false;
  private nextEarSign: 1 | -1 = 1;

  // Tail bend state
  private tailPhase = 0;
  private currentTailAmpDeg = TAIL_IDLE_DEG;
  private currentTailFreqHz = TAIL_IDLE_FREQ_HZ;
  private tailHappyBoostTimer = 0;
  private tailAnnoyedActive = false;
  private tailAnnoyedElapsed = 0;
  private currentTailAngleDeg = 0;

  // Pre-allocated tail FK buffers (zero per-frame GC)
  private readonly tailDeformedX: Float32Array;
  private readonly tailDeformedY: Float32Array;
  private readonly tailJointTheta: Float32Array;

  // Skin twitch state
  private skinTwitchActive = false;
  private skinTwitchElapsed = 0;
  private skinTwitchProgress = 0;

  // Stretch state
  private stretchActive = false;
  private stretchElapsed = 0;
  private stretchAmount = 0;

  constructor(data: CatRigData, reducedMotion = false) {
    this.data = data;
    this.reducedMotion = reducedMotion;
    if (reducedMotion) {
      this.currentBreathFreqHz = 0.35;
      this.currentBreathAmp = 0.006;
    }
    this.tailPoly = buildPolylineMetrics(data.tail);
    this.backPoly = buildPolylineMetrics(
      data.back && data.back.length >= 2
        ? data.back
        : buildFallbackBackPolyline(data),
    );

    const tailBase = data.tail[0] ?? {
      x: data.bodyCenter.x + 0.2,
      y: data.bodyCenter.y,
    };
    const ax = tailBase.x - data.head.x;
    const ay = tailBase.y - data.head.y;
    const aLen = Math.hypot(ax, ay) || 1;
    this.headTailAxisX = ax / aLen;
    this.headTailAxisY = ay / aLen;
    this.headTailPerpX = -this.headTailAxisY;
    this.headTailPerpY = this.headTailAxisX;

    this.earStates = data.ears.map(() => ({
      active: false,
      elapsed: 0,
      flickCount: 1,
      sign: 1,
      angleRad: 0,
    }));

    const tailJointCount = data.tail.length;
    this.tailDeformedX = new Float32Array(tailJointCount);
    this.tailDeformedY = new Float32Array(tailJointCount);
    this.tailJointTheta = new Float32Array(tailJointCount);
    for (let j = 0; j < tailJointCount; j++) {
      this.tailDeformedX[j] = data.tail[j].x;
      this.tailDeformedY[j] = data.tail[j].y;
    }
  }

  setMood(mood: RigMood): void {
    this.mood = mood;
  }

  setPurrLevel(level: number): void {
    this.purrLevel = clamp(level, 0, 1);
  }

  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
    if (reduced) {
      this.currentBreathFreqHz = 0.35;
      this.currentBreathAmp = Math.min(this.currentBreathAmp, 0.006);
      this.tailAnnoyedActive = false;
      this.tailHappyBoostTimer = 0;
      this.skinTwitchActive = false;
      this.skinTwitchProgress = 0;
      this.stretchActive = false;
      this.stretchAmount = 0;
      this.currentTailAngleDeg = 0;
      for (let i = 0; i < this.earStates.length; i++) {
        this.earStates[i].active = false;
        this.earStates[i].angleRad = 0;
      }
      this.updateTailFK(0);
    }
  }

  play(action: RigAction): void {
    if (this.reducedMotion) return;

    switch (action) {
      case 'earTwitch': {
        if (this.earStates.length === 0) return;
        const targetIndex =
          this.earStates.length === 1
            ? 0
            : Math.floor(Math.random() * this.earStates.length);
        const ear = this.earStates[targetIndex];
        ear.active = true;
        ear.elapsed = 0;
        ear.flickCount = Math.random() < 0.45 ? 2 : 1;
        ear.sign = this.nextEarSign;
        this.nextEarSign = this.nextEarSign === 1 ? -1 : 1;
        break;
      }
      case 'tailHappy': {
        this.tailHappyBoostTimer = TAIL_HAPPY_BURST_SEC;
        break;
      }
      case 'tailAnnoyed': {
        this.tailAnnoyedActive = true;
        this.tailAnnoyedElapsed = 0;
        break;
      }
      case 'skinTwitch': {
        this.skinTwitchActive = true;
        this.skinTwitchElapsed = 0;
        this.skinTwitchProgress = 0;
        break;
      }
      case 'stretch': {
        this.stretchActive = true;
        this.stretchElapsed = 0;
        break;
      }
    }
  }

  getStretchAmount(): number {
    return this.stretchAmount;
  }

  /** Returns true when normalised cut-out point (u, v) falls on the cat's back/torso. */
  isPointOnBack(u: number, v: number): boolean {
    const dHead = Math.hypot(u - this.data.head.x, v - this.data.head.y);
    if (dHead < this.data.headRadius * 0.72) return false;

    const tailProj = projectOntoPolyline(u, v, this.tailPoly);
    if (tailProj.dist < this.data.tailRadius * 0.72 && tailProj.s > 0.18) {
      return false;
    }

    const backProj = projectOntoPolyline(u, v, this.backPoly);
    const dBody = Math.hypot(
      u - this.data.bodyCenter.x,
      v - this.data.bodyCenter.y,
    );
    return backProj.dist < 0.28 || dBody < this.data.bodyRadius * 0.85;
  }

  update(dt: number, input?: RigUpdateInput): void {
    const clampedDt = clamp(dt, 0.0005, 0.1);

    // 1. Breathing (always active; smaller & calmer under prefers-reduced-motion)
    let targetFreqHz: number;
    let targetAmp: number;
    if (this.reducedMotion) {
      targetFreqHz = 0.35;
      targetAmp = 0.006; // ~0.47% of cat visible diameter
    } else if (this.mood === 'annoyed') {
      targetFreqHz = 0.5;
      targetAmp = 0.0108; // ~0.85% of cat visible diameter
    } else if (this.mood === 'happy') {
      targetFreqHz = 0.35;
      targetAmp = 0.0165 + this.purrLevel * 0.0022; // ~1.30% -> 1.48%
    } else {
      targetFreqHz = 0.43 - this.purrLevel * 0.06; // 0.43 -> 0.37 Hz
      targetAmp = 0.0125 + this.purrLevel * 0.003; // ~0.99% -> 1.22%
    }

    const breathLerp = 1 - Math.exp(-clampedDt / 0.55);
    this.currentBreathFreqHz +=
      (targetFreqHz - this.currentBreathFreqHz) * breathLerp;
    this.currentBreathAmp += (targetAmp - this.currentBreathAmp) * breathLerp;

    this.breathPhase =
      (this.breathPhase + clampedDt * this.currentBreathFreqHz * TWO_PI) %
      TWO_PI;
    const rawBreath = 0.5 * (1 - Math.cos(this.breathPhase));
    this.currentBreathScale =
      this.currentBreathAmp * Math.pow(rawBreath, 1.15);

    if (this.reducedMotion) {
      return;
    }

    // 2. Ear twitch triggers (random every 8-20 s + hand proximity within ~80 px of head)
    this.randomEarTimer -= clampedDt;
    if (this.randomEarTimer <= 0) {
      this.randomEarTimer = randomRange(EAR_RANDOM_MIN_SEC, EAR_RANDOM_MAX_SEC);
      this.play('earTwitch');
    }

    if (this.headProxCooldown > 0) {
      this.headProxCooldown = Math.max(0, this.headProxCooldown - clampedDt);
    }

    const handDist = input?.handDistToHeadPx;
    if (handDist !== undefined && handDist !== null) {
      if (handDist <= EAR_PROXIMITY_ENTER_PX) {
        if (!this.wasNearHead && this.headProxCooldown <= 0) {
          this.play('earTwitch');
          this.headProxCooldown = EAR_PROXIMITY_COOLDOWN_SEC;
        }
        this.wasNearHead = true;
      } else if (handDist >= EAR_PROXIMITY_EXIT_PX) {
        this.wasNearHead = false;
      }
    } else {
      this.wasNearHead = false;
    }

    for (let i = 0; i < this.earStates.length; i++) {
      const ear = this.earStates[i];
      if (!ear.active) {
        ear.angleRad = 0;
        continue;
      }
      ear.elapsed += clampedDt;
      const totalDur =
        ear.flickCount === 2
          ? EAR_FLICK_DURATION_SEC * 2 + EAR_DOUBLE_GAP_SEC
          : EAR_FLICK_DURATION_SEC;

      if (ear.elapsed >= totalDur) {
        ear.active = false;
        ear.angleRad = 0;
      } else if (ear.elapsed < EAR_FLICK_DURATION_SEC) {
        const p = ear.elapsed / EAR_FLICK_DURATION_SEC;
        const env = Math.sin(Math.pow(p, 0.72) * Math.PI);
        ear.angleRad = ear.sign * EAR_FLICK_MAX_RAD * env;
      } else if (
        ear.flickCount === 2 &&
        ear.elapsed >= EAR_FLICK_DURATION_SEC + EAR_DOUBLE_GAP_SEC
      ) {
        const p =
          (ear.elapsed - EAR_FLICK_DURATION_SEC - EAR_DOUBLE_GAP_SEC) /
          EAR_FLICK_DURATION_SEC;
        const env = Math.sin(Math.pow(p, 0.72) * Math.PI);
        ear.angleRad = ear.sign * EAR_FLICK_MAX_RAD * 0.88 * env;
      } else {
        ear.angleRad = 0;
      }
    }

    // 3. Tail sway & annoyed thump
    if (this.tailHappyBoostTimer > 0) {
      this.tailHappyBoostTimer = Math.max(
        0,
        this.tailHappyBoostTimer - clampedDt,
      );
    }

    const isHappyTail =
      this.mood === 'happy' || this.tailHappyBoostTimer > 0;
    let targetTailAmpDeg: number;
    let targetTailFreqHz: number;
    if (this.mood === 'annoyed') {
      targetTailAmpDeg = TAIL_ANNOYED_IDLE_DEG;
      targetTailFreqHz = TAIL_ANNOYED_IDLE_FREQ_HZ;
    } else if (isHappyTail) {
      targetTailAmpDeg = TAIL_HAPPY_DEG;
      targetTailFreqHz = TAIL_HAPPY_FREQ_HZ;
    } else {
      targetTailAmpDeg = TAIL_IDLE_DEG;
      targetTailFreqHz = TAIL_IDLE_FREQ_HZ;
    }

    const tailLerp = 1 - Math.exp(-clampedDt / 0.35);
    this.currentTailAmpDeg +=
      (targetTailAmpDeg - this.currentTailAmpDeg) * tailLerp;
    this.currentTailFreqHz +=
      (targetTailFreqHz - this.currentTailFreqHz) * tailLerp;

    this.tailPhase =
      (this.tailPhase + clampedDt * this.currentTailFreqHz * TWO_PI) % TWO_PI;
    // Slight harmonic richness normalised to [-1, 1] for organic sway
    const swayWave =
      (Math.sin(this.tailPhase) + 0.14 * Math.sin(this.tailPhase * 2)) / 1.14;
    let tailAngleDeg = swayWave * this.currentTailAmpDeg;

    if (this.tailAnnoyedActive) {
      this.tailAnnoyedElapsed += clampedDt;
      if (this.tailAnnoyedElapsed >= TAIL_THUMP_TOTAL_SEC) {
        this.tailAnnoyedActive = false;
      } else {
        const flickIndex = Math.min(
          TAIL_THUMP_FLICKS - 1,
          Math.floor(this.tailAnnoyedElapsed / TAIL_THUMP_FLICK_SEC),
        );
        const localP =
          (this.tailAnnoyedElapsed - flickIndex * TAIL_THUMP_FLICK_SEC) /
          TAIL_THUMP_FLICK_SEC;
        // Alternate -12 deg (outward thump), +12 deg (snap), -11 deg (outward thump)
        const dir = flickIndex % 2 === 0 ? -1 : 1;
        const decay = flickIndex === 2 ? 0.92 : 1.0;
        const flickEnv = Math.sin(Math.pow(localP, 0.7) * Math.PI);
        const thumpDeg = dir * TAIL_THUMP_MAX_DEG * decay * flickEnv;
        const overallBlend =
          1 -
          smoothstep(
            TAIL_THUMP_TOTAL_SEC - 0.12,
            TAIL_THUMP_TOTAL_SEC,
            this.tailAnnoyedElapsed,
          );
        tailAngleDeg = tailAngleDeg * (1 - overallBlend) + thumpDeg;
      }
    }

    this.currentTailAngleDeg = tailAngleDeg;
    this.updateTailFK(tailAngleDeg * DEG_TO_RAD);

    // 4. Skin twitch ripple along the back (~250 ms)
    if (this.skinTwitchActive) {
      this.skinTwitchElapsed += clampedDt;
      if (this.skinTwitchElapsed >= SKIN_TWITCH_DURATION_SEC) {
        this.skinTwitchActive = false;
        this.skinTwitchProgress = 0;
      } else {
        this.skinTwitchProgress =
          this.skinTwitchElapsed / SKIN_TWITCH_DURATION_SEC;
      }
    }

    // 5. Stretch (1.2 s lengthen, 0.8 s hold, 1.4 s relax back into melt)
    if (this.stretchActive) {
      this.stretchElapsed += clampedDt;
      if (this.stretchElapsed >= STRETCH_TOTAL_SEC) {
        this.stretchActive = false;
        this.stretchAmount = 0;
      } else if (this.stretchElapsed < STRETCH_LENGTHEN_SEC) {
        const p = this.stretchElapsed / STRETCH_LENGTHEN_SEC;
        this.stretchAmount = 0.5 * (1 - Math.cos(Math.PI * p));
      } else if (
        this.stretchElapsed <
        STRETCH_LENGTHEN_SEC + STRETCH_HOLD_SEC
      ) {
        this.stretchAmount = 1;
      } else {
        const p =
          (this.stretchElapsed - STRETCH_LENGTHEN_SEC - STRETCH_HOLD_SEC) /
          STRETCH_RELAX_SEC;
        this.stretchAmount = 0.5 * (1 + Math.cos(Math.PI * p));
      }
    } else {
      this.stretchAmount = 0;
    }
  }

  private updateTailFK(bendRad: number): void {
    const count = this.tailPoly.points.length;
    if (count === 0) return;

    const jointS = this.tailPoly.jointS;
    for (let j = 0; j < count; j++) {
      this.tailJointTheta[j] = bendRad * Math.pow(jointS[j], 1.75);
    }

    this.tailDeformedX[0] = this.tailPoly.points[0].x;
    this.tailDeformedY[0] = this.tailPoly.points[0].y;

    for (let k = 0; k < count - 1; k++) {
      const segTheta =
        0.5 * (this.tailJointTheta[k] + this.tailJointTheta[k + 1]);
      const c = Math.cos(segTheta);
      const s = Math.sin(segTheta);
      const rdx = this.tailPoly.segDx[k];
      const rdy = this.tailPoly.segDy[k];
      this.tailDeformedX[k + 1] = this.tailDeformedX[k] + rdx * c - rdy * s;
      this.tailDeformedY[k + 1] = this.tailDeformedY[k] + rdx * s + rdy * c;
    }
  }

  /**
   * Precomputes smooth per-vertex weights for a MeshPlane so every frame only
   * evaluates tight typed-array loops.
   */
  bindMesh(
    mesh: MeshPlane,
    verticesX: number,
    verticesY: number,
    uvRect: RigUvRect = DEFAULT_UV_RECT,
  ): CatRigMeshBinding {
    const positionAttr = mesh.geometry.getAttribute('aPosition');
    const positionBuffer = positionAttr.buffer;
    const positions = positionBuffer.data as Float32Array;
    const vertexCount = positions.length / 2;
    const restX = new Float32Array(vertexCount);
    const restY = new Float32Array(vertexCount);

    const meshW = mesh.texture.width || 1;
    const meshH = mesh.texture.height || 1;
    const pxPerU = meshW / uvRect.uSpan;
    const pxPerV = meshH / uvRect.vSpan;

    const breathPxX = new Float32Array(vertexCount);
    const breathPxY = new Float32Array(vertexCount);
    const stretchPxX = new Float32Array(vertexCount);
    const stretchPxY = new Float32Array(vertexCount);

    const earTmpIndices: number[][] = this.data.ears.map(() => []);
    const earTmpRelX: number[][] = this.data.ears.map(() => []);
    const earTmpRelY: number[][] = this.data.ears.map(() => []);
    const earTmpWeights: number[][] = this.data.ears.map(() => []);

    const tailTmpIndices: number[] = [];
    const tailTmpSeg: number[] = [];
    const tailTmpT: number[] = [];
    const tailTmpOx: number[] = [];
    const tailTmpOy: number[] = [];
    const tailTmpU: number[] = [];
    const tailTmpV: number[] = [];
    const tailTmpW: number[] = [];

    const backTmpIndices: number[] = [];
    const backTmpS: number[] = [];
    const backTmpNx: number[] = [];
    const backTmpNy: number[] = [];
    const backTmpW: number[] = [];

    const { bodyCenter, bodyRadius, head, headRadius, tailRadius } = this.data;

    for (let i = 0; i < vertexCount; i++) {
      const rxPx = positions[i * 2];
      const ryPx = positions[i * 2 + 1];
      restX[i] = rxPx;
      restY[i] = ryPx;

      // Local mesh normalised coords [0..1]
      const su = rxPx / meshW;
      const sv = ryPx / meshH;
      // Cut-out normalised coords [0..1]
      const u = uvRect.u0 + su * uvRect.uSpan;
      const v = uvRect.v0 + sv * uvRect.vSpan;

      // Pin extreme transparent border vertices so filter bounds never jitter frame-to-frame
      const borderDist = Math.min(su, 1 - su, sv, 1 - sv);
      const edgePin = smoothstep(0.0, 0.035, borderDist);

      const dHead = Math.hypot(u - head.x, v - head.y);
      const tailProj = projectOntoPolyline(u, v, this.tailPoly);
      const backProj = projectOntoPolyline(u, v, this.backPoly);

      // Breathing: gentle radial expansion around bodyCenter; head & tail barely move
      const bx = u - bodyCenter.x;
      const by = v - bodyCenter.y;
      const dBody = Math.hypot(bx, by);
      const outerBreathEnv =
        1 - smoothstep(bodyRadius * 1.05, bodyRadius * 1.55, dBody);
      const headKeep =
        0.06 + 0.94 * smoothstep(headRadius * 0.55, headRadius * 1.38, dHead);
      const tailKeep =
        0.06 +
        0.94 *
          smoothstep(tailRadius * 0.65, tailRadius * 1.55, tailProj.dist);
      const wBreath = outerBreathEnv * headKeep * tailKeep * edgePin;
      breathPxX[i] = bx * wBreath * pxPerU;
      breathPxY[i] = by * wBreath * pxPerV;

      // Stretch: lengthen ~3% along head-tail axis with subtle -1% transverse slimming
      const projAxis = bx * this.headTailAxisX + by * this.headTailAxisY;
      const projPerp = bx * this.headTailPerpX + by * this.headTailPerpY;
      const stretchDu =
        (STRETCH_AXIS_SCALE * projAxis * this.headTailAxisX +
          STRETCH_PERP_SCALE * projPerp * this.headTailPerpX) *
        edgePin;
      const stretchDv =
        (STRETCH_AXIS_SCALE * projAxis * this.headTailAxisY +
          STRETCH_PERP_SCALE * projPerp * this.headTailPerpY) *
        edgePin;
      stretchPxX[i] = stretchDu * pxPerU;
      stretchPxY[i] = stretchDv * pxPerV;

      // Ear weights (plateau around ear pinna, rotating around ear.base)
      for (let e = 0; e < this.data.ears.length; e++) {
        const ear = this.data.ears[e];
        const midX = (ear.base.x + ear.tip.x) * 0.5;
        const midY = (ear.base.y + ear.tip.y) * 0.5;
        const dEar = Math.hypot(u - midX, v - midY);
        const wEar =
          (1 - smoothstep(ear.radius * 0.58, ear.radius * 1.15, dEar)) *
          edgePin;
        if (wEar > 0.001) {
          earTmpIndices[e].push(i);
          earTmpRelX[e].push(u - ear.base.x);
          earTmpRelY[e].push(v - ear.base.y);
          earTmpWeights[e].push(wEar);
        }
      }

      // Tail weights (smooth radial falloff around tail polyline, anchored at base, guarded from head)
      if (this.tailPoly.points.length >= 2) {
        const radialW =
          1 - smoothstep(tailRadius * 0.45, tailRadius * 1.65, tailProj.dist);
        const baseRamp = smoothstep(0.0, 0.16, tailProj.s);
        const headGuard = smoothstep(
          headRadius * 0.45,
          headRadius * 1.15,
          dHead,
        );
        const wTail = radialW * baseRamp * headGuard * edgePin;
        if (wTail > 0.001) {
          tailTmpIndices.push(i);
          tailTmpSeg.push(tailProj.segIndex);
          tailTmpT.push(tailProj.segT);
          tailTmpOx.push(u - tailProj.closestX);
          tailTmpOy.push(v - tailProj.closestY);
          tailTmpU.push(u);
          tailTmpV.push(v);
          tailTmpW.push(wTail);
        }
      }

      // Back / skin-twitch weights (perpendicular wave along spine)
      if (this.backPoly.points.length >= 2) {
        const backRadial = 1 - smoothstep(0.07, 0.24, backProj.dist);
        const endTaper =
          smoothstep(0.0, 0.08, backProj.s) *
          (1 - smoothstep(0.92, 1.0, backProj.s));
        const headGuard = smoothstep(
          headRadius * 0.68,
          headRadius * 1.22,
          dHead,
        );
        const tailGuard = smoothstep(
          tailRadius * 0.68,
          tailRadius * 1.32,
          tailProj.dist,
        );
        const wBack = backRadial * endTaper * headGuard * tailGuard * edgePin;
        if (wBack > 0.001) {
          backTmpIndices.push(i);
          backTmpS.push(backProj.s);
          backTmpNx.push(backProj.normalX);
          backTmpNy.push(backProj.normalY);
          backTmpW.push(wBack);
        }
      }
    }

    const earBindings: EarVertexBinding[] = this.data.ears.map((ear, e) => ({
      earIndex: e,
      pivotX: ear.base.x,
      pivotY: ear.base.y,
      count: earTmpIndices[e].length,
      indices: new Uint16Array(earTmpIndices[e]),
      relX: new Float32Array(earTmpRelX[e]),
      relY: new Float32Array(earTmpRelY[e]),
      weights: new Float32Array(earTmpWeights[e]),
    }));

    const tailBinding: TailVertexBinding = {
      count: tailTmpIndices.length,
      indices: new Uint16Array(tailTmpIndices),
      segIndices: new Uint8Array(tailTmpSeg),
      segT: new Float32Array(tailTmpT),
      offsetX: new Float32Array(tailTmpOx),
      offsetY: new Float32Array(tailTmpOy),
      restU: new Float32Array(tailTmpU),
      restV: new Float32Array(tailTmpV),
      weights: new Float32Array(tailTmpW),
    };

    const backBinding: BackVertexBinding = {
      count: backTmpIndices.length,
      indices: new Uint16Array(backTmpIndices),
      spineS: new Float32Array(backTmpS),
      normalX: new Float32Array(backTmpNx),
      normalY: new Float32Array(backTmpNy),
      weights: new Float32Array(backTmpW),
    };

    return {
      mesh,
      verticesX,
      verticesY,
      vertexCount,
      positionBuffer,
      positions,
      restX,
      restY,
      pxPerU,
      pxPerV,
      breathPxX,
      breathPxY,
      stretchPxX,
      stretchPxY,
      earBindings,
      tailBinding,
      backBinding,
    };
  }

  /** Evaluates all active deformers into the bound MeshPlane's vertex buffer. */
  applyToMesh(binding: CatRigMeshBinding): void {
    const {
      positions,
      restX,
      restY,
      vertexCount,
      breathPxX,
      breathPxY,
      stretchPxX,
      stretchPxY,
      pxPerU,
      pxPerV,
    } = binding;

    const bScale = this.currentBreathScale;
    const sScale = this.stretchAmount;

    // Pass 1: base rest + breathing + stretch (dense pass over all vertices)
    if (sScale > 1e-5) {
      for (let i = 0; i < vertexCount; i++) {
        const idx2 = i * 2;
        positions[idx2] =
          restX[i] + breathPxX[i] * bScale + stretchPxX[i] * sScale;
        positions[idx2 + 1] =
          restY[i] + breathPxY[i] * bScale + stretchPxY[i] * sScale;
      }
    } else {
      for (let i = 0; i < vertexCount; i++) {
        const idx2 = i * 2;
        positions[idx2] = restX[i] + breathPxX[i] * bScale;
        positions[idx2 + 1] = restY[i] + breathPxY[i] * bScale;
      }
    }

    if (!this.reducedMotion) {
      // Pass 2: progressive tail bend (sparse pass)
      if (
        Math.abs(this.currentTailAngleDeg) > 0.005 &&
        binding.tailBinding.count > 0
      ) {
        const tb = binding.tailBinding;
        const defX = this.tailDeformedX;
        const defY = this.tailDeformedY;
        const jTheta = this.tailJointTheta;

        for (let m = 0; m < tb.count; m++) {
          const vIdx2 = tb.indices[m] * 2;
          const k = tb.segIndices[m];
          const t = tb.segT[m];
          const qx = defX[k] + (defX[k + 1] - defX[k]) * t;
          const qy = defY[k] + (defY[k + 1] - defY[k]) * t;
          const theta = jTheta[k] + (jTheta[k + 1] - jTheta[k]) * t;
          const c = Math.cos(theta);
          const s = Math.sin(theta);
          const ox = tb.offsetX[m];
          const oy = tb.offsetY[m];
          const tx = qx + ox * c - oy * s;
          const ty = qy + ox * s + oy * c;
          const w = tb.weights[m];
          positions[vIdx2] += (tx - tb.restU[m]) * w * pxPerU;
          positions[vIdx2 + 1] += (ty - tb.restV[m]) * w * pxPerV;
        }
      }

      // Pass 3: ear twitches (sparse pass per active ear)
      for (let e = 0; e < binding.earBindings.length; e++) {
        const angle = this.earStates[e]?.angleRad ?? 0;
        if (Math.abs(angle) < 1e-5) continue;
        const eb = binding.earBindings[e];
        for (let m = 0; m < eb.count; m++) {
          const vIdx2 = eb.indices[m] * 2;
          const a = angle * eb.weights[m];
          const ca = Math.cos(a) - 1;
          const sa = Math.sin(a);
          const rx = eb.relX[m];
          const ry = eb.relY[m];
          positions[vIdx2] += (rx * ca - ry * sa) * pxPerU;
          positions[vIdx2 + 1] += (rx * sa + ry * ca) * pxPerV;
        }
      }

      // Pass 4: back skin-twitch traveling ripple (sparse pass when active)
      if (this.skinTwitchActive && binding.backBinding.count > 0) {
        const bb = binding.backBinding;
        const p = this.skinTwitchProgress;
        const front = -0.05 + 1.13 * p;
        const timeEnv =
          smoothstep(0.0, 0.12, p) * (1 - smoothstep(0.75, 1.0, p));
        const amp = SKIN_TWITCH_AMP_UV * timeEnv;
        const invTwoSigmaSq =
          1 / (2 * SKIN_TWITCH_PACKET_SIGMA * SKIN_TWITCH_PACKET_SIGMA);
        const kWave = TWO_PI / SKIN_TWITCH_WAVELENGTH;

        for (let m = 0; m < bb.count; m++) {
          const ds = bb.spineS[m] - front;
          const envSq = ds * ds * invTwoSigmaSq;
          if (envSq > 6.5) continue;
          const packet = Math.exp(-envSq) * Math.sin(ds * kWave);
          const disp = amp * packet * bb.weights[m];
          const vIdx2 = bb.indices[m] * 2;
          positions[vIdx2] += bb.normalX[m] * disp * pxPerU;
          positions[vIdx2 + 1] += bb.normalY[m] * disp * pxPerV;
        }
      }
    }

    binding.positionBuffer.update();
  }

  /** Evaluates deformed rig landmarks for the `?rig=1` debug overlay. */
  getDebugState(): RigDebugState {
    const sScale = this.stretchAmount;
    const stretchPoint = (p: RigPoint): RigPoint => {
      if (sScale <= 1e-5) return p;
      const bx = p.x - this.data.bodyCenter.x;
      const by = p.y - this.data.bodyCenter.y;
      const projAxis = bx * this.headTailAxisX + by * this.headTailAxisY;
      const projPerp = bx * this.headTailPerpX + by * this.headTailPerpY;
      return {
        x:
          p.x +
          (STRETCH_AXIS_SCALE * projAxis * this.headTailAxisX +
            STRETCH_PERP_SCALE * projPerp * this.headTailPerpX) *
            sScale,
        y:
          p.y +
          (STRETCH_AXIS_SCALE * projAxis * this.headTailAxisY +
            STRETCH_PERP_SCALE * projPerp * this.headTailPerpY) *
            sScale,
      };
    };

    const ears = this.data.ears.map((ear, i) => {
      const angle = this.earStates[i]?.angleRad ?? 0;
      const base = stretchPoint(ear.base);
      const restTip = stretchPoint(ear.tip);
      const rx = restTip.x - base.x;
      const ry = restTip.y - base.y;
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      return {
        id: ear.id,
        base,
        tip: {
          x: base.x + rx * c - ry * s,
          y: base.y + rx * s + ry * c,
        },
        radius: ear.radius,
        angleDeg: angle * RAD_TO_DEG,
      };
    });

    const tail: RigPoint[] = [];
    for (let j = 0; j < this.tailDeformedX.length; j++) {
      tail.push(
        stretchPoint({
          x: this.tailDeformedX[j],
          y: this.tailDeformedY[j],
        }),
      );
    }

    const back: RigPoint[] = this.backPoly.points.map((p) => {
      const sp = stretchPoint(p);
      const bx = p.x - this.data.bodyCenter.x;
      const by = p.y - this.data.bodyCenter.y;
      return {
        x: sp.x + bx * this.currentBreathScale,
        y: sp.y + by * this.currentBreathScale,
      };
    });

    return {
      mood: this.mood,
      reducedMotion: this.reducedMotion,
      bodyCenter: this.data.bodyCenter,
      bodyRadius: this.data.bodyRadius,
      head: stretchPoint(this.data.head),
      headRadius: this.data.headRadius,
      ears,
      tail,
      back,
      breathScale: this.currentBreathScale,
      tailAngleDeg: this.currentTailAngleDeg,
      stretchAmount: this.stretchAmount,
      skinTwitchProgress: this.skinTwitchProgress,
    };
  }
}
