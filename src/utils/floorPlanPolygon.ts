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
