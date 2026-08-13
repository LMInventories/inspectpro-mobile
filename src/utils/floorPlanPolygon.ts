/**
 * Turtle-graphics polygon math for the manual floor-plan tool: the
 * inspector walks the room's perimeter, measures each wall (laser measure
 * or tape), and this turns that sequence of wall-length + turn-angle
 * entries into a 2D point list.
 *
 * Deliberately does not force-close the polygon — small cumulative
 * measurement error should be visible to the inspector (the last point
 * landing slightly away from the first), not silently papered over.
 * FloorPlanDrawScreen closes it visually when rendering the finished plan.
 */

export type WallEntry = {
  lengthM: number
  turnDeg: number // exterior turn applied AFTER this wall, before the next one
}

export type Point = { x: number; z: number }

// Matches models.FloorPlanRoom's `data.symbols` shape on the backend
// (backend/models.py) — doors/windows are wall-attached (an opening broken
// into a specific wall edge); stairs are a free floor feature positioned
// by (x, z), not tied to a wall, matching standard architectural
// convention that stairs aren't a wall opening the way a door/window is.
export type DoorWindowSymbol = {
  type: 'door' | 'window'
  wallIndex: number
  positionFraction: number // 0-1 along that wall edge
  widthM: number
}

export type StairsSymbol = {
  type: 'stairs'
  x: number
  z: number
  rotationDeg: number
  lengthM: number
  widthM: number
  direction: 'up' | 'down'
}

export type FloorPlanSymbol = DoorWindowSymbol | StairsSymbol

export function computePolygon(walls: WallEntry[]): Point[] {
  let x = 0
  let z = 0
  let headingDeg = 0
  const points: Point[] = [{ x, z }]

  for (const wall of walls) {
    const rad = (headingDeg * Math.PI) / 180
    x += wall.lengthM * Math.cos(rad)
    z += wall.lengthM * Math.sin(rad)
    points.push({ x, z })
    headingDeg += wall.turnDeg
  }

  return points
}

/** SVG polygon "points" attribute string, y-flipped isn't needed here since
 * this is a top-down plan view, not a screen-space drawing — x/z map
 * directly. Scale/offset are the caller's job (depends on the view size). */
export function pointsToSvgString(points: Point[], scale: number, offsetX: number, offsetZ: number): string {
  return points
    .map((p) => `${(p.x * scale + offsetX).toFixed(1)},${(p.z * scale + offsetZ).toFixed(1)}`)
    .join(' ')
}

/**
 * Law of cosines: the INTERIOR angle at the corner shared by two walls of
 * length `a` and `b`, given the diagonal `d` connecting their far
 * (non-shared) endpoints — a plain length measurement, same as any laser-
 * measure reading. Replaces asking the inspector to estimate degrees
 * (nobody carries a protractor) with a second real measurement, matching
 * how MagicPlan's "diagonal measurement" feature works.
 *
 * IMPORTANT: this returns the polygon's INTERIOR angle (what you'd measure
 * standing at the real corner), NOT computePolygon's WallEntry.turnDeg,
 * which is a turtle-graphics EXTERIOR turn. For a simple polygon walked in
 * one consistent rotational direction, turnDeg = 180 - interiorAngle — the
 * caller must apply that conversion. These are only coincidentally equal
 * at exactly 90 degrees (180-90=90), which is why testing solely against
 * a square room wouldn't have caught using this value directly as turnDeg
 * — verified against a real non-90-degree case (sides 5, 6, diagonal 7)
 * before this was wired into the draw screen.
 *
 * Clamped to [-1, 1] before acos: real-world measurement noise can push
 * (a,b,d) just outside a mathematically valid triangle (e.g. d measured
 * very slightly too long), which would otherwise make acos() return NaN
 * for an angle that's obviously supposed to be close to 0 or 180 degrees.
 */
export function angleFromDiagonal(a: number, b: number, d: number): number {
  const cosAngle = (a * a + b * b - d * d) / (2 * a * b)
  const clamped = Math.max(-1, Math.min(1, cosAngle))
  return (Math.acos(clamped) * 180) / Math.PI
}

/** Converts angleFromDiagonal's interior angle into computePolygon's
 * exterior turnDeg — see angleFromDiagonal's docstring for why this
 * conversion is required, not optional. */
export function interiorAngleToTurnDeg(interiorAngleDeg: number): number {
  return 180 - interiorAngleDeg
}
