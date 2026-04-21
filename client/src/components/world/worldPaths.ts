/**
 * worldPaths.ts
 *
 * Room layout (tightened v2):
 *
 *   x:  30        630 690                1290
 *       |          |   |                  |
 *  y:30  [BEDROOM 600w] [OFFICE 600w       ]
 * y:430          ↕       ↕
 * y:490  [CLINIC 400w] [BREAKROOM 800w     ]
 * y:710      ↕
 * y:780                     ↕ (breakroom south)
 * y:840  [BEACH 1260w                      ]
 *
 * Corridors:
 *   bedroom  ↔ office     horizontal at y≈230, x 630–690
 *   bedroom  ↔ clinic     vertical   at x≈230, y 430–490
 *   office   ↔ breakroom  vertical   at x≈990, y 430–490
 *   clinic   ↔ breakroom  horizontal at y≈600, x 430–490
 *   clinic   → beach      vertical   at x≈220, y 710–840
 *   breakroom→ beach      vertical   at x≈880, y 780–840
 */

import type { RoomId } from "./rooms.config";

export type WorldPoint = { x: number; y: number };

export const DOORS = {
  bedroomEast:    { x: 628, y: 230 },
  officeWest:     { x: 692, y: 230 },

  bedroomSouth:   { x: 230, y: 428 },
  clinicNorth:    { x: 230, y: 492 },

  officeSouth:    { x: 990, y: 428 },
  breakroomNorth: { x: 990, y: 492 },

  clinicEast:     { x: 428, y: 600 },
  breakroomWest:  { x: 492, y: 600 },

  clinicSouth:    { x: 220, y: 708 },
  beachNW:        { x: 220, y: 842 },

  breakroomSouth: { x: 880, y: 778 },
  beachNE:        { x: 880, y: 842 },
};

const CORRIDORS: Partial<Record<string, WorldPoint[]>> = {
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

  "bedroom→breakroom": [
    DOORS.bedroomEast, DOORS.officeWest,
    DOORS.officeSouth, DOORS.breakroomNorth,
  ],
  "breakroom→bedroom": [
    DOORS.breakroomNorth, DOORS.officeSouth,
    DOORS.officeWest, DOORS.bedroomEast,
  ],

  "bedroom→beach": [
    DOORS.bedroomSouth, DOORS.clinicNorth,
    DOORS.clinicSouth,  DOORS.beachNW,
  ],
  "beach→bedroom": [
    DOORS.beachNW,      DOORS.clinicSouth,
    DOORS.clinicNorth,  DOORS.bedroomSouth,
  ],

  "office→clinic": [
    DOORS.officeWest,   DOORS.bedroomEast,
    DOORS.bedroomSouth, DOORS.clinicNorth,
  ],
  "clinic→office": [
    DOORS.clinicNorth,  DOORS.bedroomSouth,
    DOORS.bedroomEast,  DOORS.officeWest,
  ],

  "office→beach": [
    DOORS.officeSouth,    DOORS.breakroomNorth,
    DOORS.breakroomSouth, DOORS.beachNE,
  ],
  "beach→office": [
    DOORS.beachNE,        DOORS.breakroomSouth,
    DOORS.breakroomNorth, DOORS.officeSouth,
  ],
};

export function getWalkPath(
  from: RoomId,
  to: RoomId,
  currentPos: WorldPoint,
  targetSlot: WorldPoint,
): WorldPoint[] {
  void currentPos;
  if (from === to) return [targetSlot];
  const key = `${from}→${to}`;
  const corridor = CORRIDORS[key] ?? [];
  return [...corridor, targetSlot];
}
