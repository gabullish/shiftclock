/**
 * worldPaths.ts
 *
 * Defines the corridor waypoint graph for the virtual office.
 * Every room-to-room transition is resolved to an ordered list of
 * world-coordinate points an agent walks through — no teleportation.
 *
 * Layout reference:
 *
 *   x:  30        780 840           1590
 *       |          |   |             |
 *  y:30  [BEDROOM      ] [OFFICE         ]
 *  y:510          ↕   ↕               ← south corridors
 *  y:570  [CLINIC    ] [BREAKROOM        ]
 *  y:940          ↕                   ← down to beach
 * y:1000  [BEACH                        ]
 *
 * Horizontal corridor: bedroom ↔ office at y≈260
 * Vertical corridors:  bedroom ↔ clinic  at x≈260
 *                      office  ↔ breakroom at x≈1060
 *                      clinic  ↔ breakroom at y≈755
 *                      clinic  → beach    at x≈310
 *                      breakroom→beach    at x≈1110
 */

import type { RoomId } from "./rooms.config";

export type WorldPoint = { x: number; y: number };

// ── Doorway positions (absolute world coords) ────────────────────────────────
// Each doorway is defined once; paths reference both sides.

export const DOORS = {
  // Bedroom east / Office west — horizontal corridor
  bedroomEast:     { x: 778, y: 260 },
  officeWest:      { x: 842, y: 260 },

  // Bedroom south / Clinic north — vertical corridor (left side)
  bedroomSouth:    { x: 260, y: 508 },
  clinicNorth:     { x: 260, y: 572 },

  // Office south / Breakroom north — vertical corridor (right side)
  officeSouth:     { x: 1060, y: 508 },
  breakroomNorth:  { x: 1060, y: 572 },

  // Clinic east / Breakroom west — horizontal corridor (mid)
  clinicEast:      { x: 688, y: 755 },
  breakroomWest:   { x: 752, y: 755 },

  // Clinic south / Beach north-west — vertical corridor
  clinicSouth:     { x: 310, y: 938 },
  beachNW:         { x: 310, y: 1002 },

  // Breakroom south / Beach north-east — vertical corridor
  breakroomSouth:  { x: 1110, y: 938 },
  beachNE:         { x: 1110, y: 1002 },
};

// ── Corridor waypoints per transition ────────────────────────────────────────
// Source slot and destination slot are NOT included here —
// getWalkPath() prepends the source position and appends the target slot.

const CORRIDORS: Partial<Record<string, WorldPoint[]>> = {
  // ── Direct connections ──
  "bedroom→office":    [DOORS.bedroomEast,    DOORS.officeWest],
  "office→bedroom":    [DOORS.officeWest,     DOORS.bedroomEast],

  "bedroom→clinic":    [DOORS.bedroomSouth,   DOORS.clinicNorth],
  "clinic→bedroom":    [DOORS.clinicNorth,    DOORS.bedroomSouth],

  "office→breakroom":  [DOORS.officeSouth,    DOORS.breakroomNorth],
  "breakroom→office":  [DOORS.breakroomNorth, DOORS.officeSouth],

  "clinic→breakroom":  [DOORS.clinicEast,     DOORS.breakroomWest],
  "breakroom→clinic":  [DOORS.breakroomWest,  DOORS.clinicEast],

  "clinic→beach":      [DOORS.clinicSouth,    DOORS.beachNW],
  "beach→clinic":      [DOORS.beachNW,        DOORS.clinicSouth],

  "breakroom→beach":   [DOORS.breakroomSouth, DOORS.beachNE],
  "beach→breakroom":   [DOORS.beachNE,        DOORS.breakroomSouth],

  // ── Two-hop connections ──
  // bedroom ↔ breakroom  (via office)
  "bedroom→breakroom": [
    DOORS.bedroomEast, DOORS.officeWest,
    DOORS.officeSouth, DOORS.breakroomNorth,
  ],
  "breakroom→bedroom": [
    DOORS.breakroomNorth, DOORS.officeSouth,
    DOORS.officeWest, DOORS.bedroomEast,
  ],

  // bedroom ↔ beach  (via clinic — shorter side)
  "bedroom→beach": [
    DOORS.bedroomSouth, DOORS.clinicNorth,
    DOORS.clinicSouth, DOORS.beachNW,
  ],
  "beach→bedroom": [
    DOORS.beachNW, DOORS.clinicSouth,
    DOORS.clinicNorth, DOORS.bedroomSouth,
  ],

  // office ↔ clinic  (via bedroom — geometrically closest)
  "office→clinic": [
    DOORS.officeWest, DOORS.bedroomEast,
    DOORS.bedroomSouth, DOORS.clinicNorth,
  ],
  "clinic→office": [
    DOORS.clinicNorth, DOORS.bedroomSouth,
    DOORS.bedroomEast, DOORS.officeWest,
  ],

  // office ↔ beach  (via breakroom)
  "office→beach": [
    DOORS.officeSouth, DOORS.breakroomNorth,
    DOORS.breakroomSouth, DOORS.beachNE,
  ],
  "beach→office": [
    DOORS.beachNE, DOORS.breakroomSouth,
    DOORS.breakroomNorth, DOORS.officeSouth,
  ],
};

/**
 * Returns the full ordered list of world-coordinate waypoints an agent
 * should walk through when moving from one room to another.
 *
 * Includes the current position as the first point and the
 * target slot as the last point so the caller can simply iterate.
 */
export function getWalkPath(
  from: RoomId,
  to: RoomId,
  currentPos: WorldPoint,
  targetSlot: WorldPoint,
): WorldPoint[] {
  if (from === to) return [targetSlot];
  const key = `${from}→${to}`;
  const corridor = CORRIDORS[key] ?? [];
  return [currentPos, ...corridor, targetSlot];
}
