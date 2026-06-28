/**
 * worldPaths.ts — hub-and-spoke layout for the 1380×1140 map.
 *
 * Every room opens into a central cross-shaped hallway:
 *   • a vertical corridor at x≈680 linking bedroom (top-left), workstation
 *     (top-right) and the break room (bottom-middle),
 *   • a horizontal corridor at y≈620 linking the clinic (left) and vacation (right),
 *   • crossing at (680, 620).
 *
 * A trip is: current seat → own door → corridor → (cross if changing axis) →
 * target door → target seat. Coordinates are image pixels (from the mapping).
 */

import type { RoomId } from "./rooms.config";

export type WorldPoint = { x: number; y: number };

// Exact door centers (where each room meets the hallway).
const DOOR: Record<RoomId, WorldPoint> = {
  bedroom:   { x: 625, y: 298 },
  office:    { x: 734, y: 302 },
  clinic:    { x: 394, y: 623 },
  breakroom: { x: 679, y: 706 },
  beach:     { x: 977, y: 623 },
};

// Each door's entry point on its corridor centerline (just inside the hallway).
const ENTRY: Record<RoomId, WorldPoint> = {
  bedroom:   { x: 680, y: 300 },
  office:    { x: 680, y: 302 },
  breakroom: { x: 680, y: 700 },
  clinic:    { x: 440, y: 620 },
  beach:     { x: 940, y: 620 },
};

// Rooms served by the vertical corridor vs. the horizontal corridor.
const VERTICAL: Record<RoomId, boolean> = {
  bedroom: true, office: true, breakroom: true, clinic: false, beach: false,
};

const CROSS: WorldPoint = { x: 680, y: 620 };

export function getWalkPath(
  from: RoomId,
  to: RoomId,
  currentPos: WorldPoint,
  targetSlot: WorldPoint,
): WorldPoint[] {
  void currentPos;
  if (from === to) return [targetSlot];
  // Exit own room, reach own corridor. Cross to the other axis only when the
  // source and target corridors differ; same-axis trips stay on one line.
  const mid = VERTICAL[from] === VERTICAL[to] ? [] : [CROSS];
  return [DOOR[from], ENTRY[from], ...mid, ENTRY[to], DOOR[to], targetSlot];
}
