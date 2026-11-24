import type { CatRigData } from '../rig';

/**
 * Hand-measured 2D rig landmarks for the bundled sample cat
 * (`src/assets/photo/sample-cat.webp`, 1536 x 1536 cut-out).
 *
 * All coordinates are normalised (0-1) in cut-out texture space:
 * - Alpha bounds span x = [0.127, 0.883], y = [0.125, 0.887].
 * - Curled sleeping tabby: torso/ribcage fills upper-right & centre, head sits
 *   lower-left with one clearly visible ear (other ear tucked underneath), and
 *   the fluffy tail wraps along the bottom from the rump toward the paws.
 */
export const SAMPLE_CAT_RIG: CatRigData = {
  bodyCenter: { x: 0.55, y: 0.42 },
  bodyRadius: 0.34,
  head: { x: 0.32, y: 0.615 },
  headRadius: 0.14,
  ears: [
    {
      id: 'left',
      base: { x: 0.225, y: 0.668 },
      tip: { x: 0.18, y: 0.73 },
      radius: 0.068,
    },
  ],
  // 7-point tail polyline from base at rump to fluffy tip near paws
  tail: [
    { x: 0.765, y: 0.645 },
    { x: 0.718, y: 0.708 },
    { x: 0.652, y: 0.762 },
    { x: 0.572, y: 0.802 },
    { x: 0.482, y: 0.818 },
    { x: 0.402, y: 0.798 },
    { x: 0.356, y: 0.758 },
  ],
  tailRadius: 0.095,
  // Arched spine polyline (shoulders -> mid-back -> rump) for back skin-twitch wave
  back: [
    { x: 0.245, y: 0.465 },
    { x: 0.285, y: 0.305 },
    { x: 0.485, y: 0.215 },
    { x: 0.695, y: 0.305 },
    { x: 0.785, y: 0.515 },
  ],
};
