// Shared zoom model for the camera zoom slider (floating preview + full-screen camera).
//
// The clerk sees one scale in "x" units: 1.0x is the main lens, 0.6x the ultra-wide, up to 5x.
// This file maps that scale to (which lens, what native zoom factor) and back, snaps to 0.1x
// steps, and turns drag distance + drag speed into zoom change (slow drags = fine control,
// fast drags = cover the range quickly).

export const ZOOM_STEP = 0.1
export const ZOOM_ULTRA_X = 0.6     // the ultra-wide lens, in x units
export const ZOOM_MAX_X = 5

export type LensSpec = { neutral: number; min: number; max: number }
export type LensConfig = {
  main: LensSpec
  ultra: LensSpec | null     // a SEPARATE ultra-wide camera device, if the phone exposes one
  zoomUltra: boolean         // ultra-wide reached by zooming out on the main (virtual) device
}
export type LensChoice = { ultra: boolean; zoom: number }

export const round1 = (x: number) => Math.round(x * 10) / 10
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))

// Lowest and highest x the slider offers on this phone.
export function zoomRange(cfg: LensConfig): { min: number; max: number } {
  let min = 1
  if (cfg.ultra) min = ZOOM_ULTRA_X
  else if (cfg.zoomUltra) min = Math.max(ZOOM_ULTRA_X, Math.ceil((cfg.main.min / cfg.main.neutral) * 10 - 1e-9) / 10)
  const max = Math.min(ZOOM_MAX_X, Math.floor((cfg.main.max / cfg.main.neutral) * 10 + 1e-9) / 10)
  return { min, max: Math.max(max, min) }
}

export function snapZoom(x: number, min: number, max: number): number {
  return round1(clamp(x, min, max))
}

// x on the slider -> which device to use and its native zoom factor.
export function xToLens(x: number, cfg: LensConfig): LensChoice {
  const { min, max } = zoomRange(cfg)
  const v = clamp(x, min, max)
  if (cfg.ultra && v < 1) {
    // Ultra-wide at its own 1.0 is 0.6x; anything between 0.6x and 1x is a digital crop of it.
    return { ultra: true, zoom: clamp(cfg.ultra.neutral * (v / ZOOM_ULTRA_X), cfg.ultra.min, cfg.ultra.max) }
  }
  return { ultra: false, zoom: clamp(cfg.main.neutral * v, cfg.main.min, cfg.main.max) }
}

// Native zoom on a device -> x on the slider (used when pinch-to-zoom moves the zoom).
export function lensToX(choice: LensChoice, cfg: LensConfig): number {
  const { min, max } = zoomRange(cfg)
  const x = choice.ultra && cfg.ultra
    ? ZOOM_ULTRA_X * (choice.zoom / cfg.ultra.neutral)
    : choice.zoom / cfg.main.neutral
  return round1(clamp(x, min, max))
}

// Drag speed (px per ms) -> multiplier on how far the zoom moves per px dragged.
const SLOW_V = 0.3, FAST_V = 2.5, SLOW_GAIN = 0.5, FAST_GAIN = 3
export function speedGain(vPxPerMs: number): number {
  const v = Math.abs(vPxPerMs)
  if (v <= SLOW_V) return SLOW_GAIN
  if (v >= FAST_V) return FAST_GAIN
  return SLOW_GAIN + ((v - SLOW_V) / (FAST_V - SLOW_V)) * (FAST_GAIN - SLOW_GAIN)
}

// New (unsnapped) zoom after dragging `deltaPx` along a track of `trackPx` at the given speed.
export function dragZoom(current: number, deltaPx: number, vPxPerMs: number, trackPx: number, min: number, max: number): number {
  return clamp(current + (deltaPx / trackPx) * (max - min) * speedGain(vPxPerMs), min, max)
}
