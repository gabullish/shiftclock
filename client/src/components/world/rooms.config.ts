export type RoomId = "office" | "bedroom" | "clinic" | "breakroom" | "beach";

// Tighter map — ~20% smaller than v1 to remove empty space, since rooms are
// rarely filled to capacity. Capacity still exceeds 13 agents per room worst-case.
export const WORLD_W = 1320;
export const WORLD_H = 1090;

export interface RoomDef {
  id: RoomId;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  floorColor: number;
  wallColor: number;
  accentColor: number;
  labelColor: string;
  slots: { x: number; y: number }[];
  exitX: number;
  exitY: number;
}

function makeSlots(
  baseX: number, baseY: number,
  cols: number, rows: number,
  startX: number, startY: number,
  gapX: number, gapY: number
): { x: number; y: number }[] {
  const slots: { x: number; y: number }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      slots.push({ x: baseX + startX + c * gapX, y: baseY + startY + r * gapY });
    }
  }
  return slots;
}

export const ROOMS: Record<RoomId, RoomDef> = {
  // ── Office: top-right, 600×400 ─────────────────────────────
  // Slots: 4 cols × 3 rows = 12
  office: {
    id: "office",
    label: "Office",
    x: 690, y: 30, w: 600, h: 400,
    floorColor: 0x1e2d42,
    wallColor: 0x14213a,
    accentColor: 0x3a7bd5,
    labelColor: "#6aaef8",
    slots: makeSlots(690, 30, 4, 3, 80, 90, 140, 115),
    exitX: 0, exitY: 200,
  },

  // ── Bedroom: top-left, 600×400 ─────────────────────────────
  bedroom: {
    id: "bedroom",
    label: "Bedroom",
    x: 30, y: 30, w: 600, h: 400,
    floorColor: 0x1e1e38,
    wallColor: 0x141430,
    accentColor: 0x7b5ea7,
    labelColor: "#b09ed4",
    slots: makeSlots(30, 30, 4, 3, 80, 90, 140, 115),
    exitX: 600, exitY: 200,
  },

  // ── Clinic: mid-left, 400×220 — compact, rarely >3 sick at once ──
  clinic: {
    id: "clinic",
    label: "Clinic",
    x: 30, y: 490, w: 400, h: 220,
    floorColor: 0x1a2e24,
    wallColor: 0x112018,
    accentColor: 0x4ecba1,
    labelColor: "#7de8c3",
    slots: makeSlots(30, 490, 3, 1, 80, 110, 130, 0),
    exitX: 400, exitY: 110,
  },

  // ── Break room: mid-right, starts right of clinic ──────────
  // Slots: 4 cols × 2 rows = 8
  breakroom: {
    id: "breakroom",
    label: "Break Room",
    x: 490, y: 490, w: 800, h: 290,
    floorColor: 0x2a1e1a,
    wallColor: 0x1e1210,
    accentColor: 0xe07b54,
    labelColor: "#f0a080",
    slots: makeSlots(490, 490, 4, 2, 80, 75, 195, 140),
    exitX: 0, exitY: 145,
  },

  // ── Beach: bottom strip, 1260×210 ──────────────────────────
  // Slots: 6 cols × 1 row = 6
  beach: {
    id: "beach",
    label: "Beach",
    x: 30, y: 840, w: 1260, h: 210,
    floorColor: 0x1a4a5e,
    wallColor: 0x0e3a50,
    accentColor: 0xf4d03f,
    labelColor: "#f7e07a",
    slots: makeSlots(30, 860, 6, 1, 120, 105, 200, 0),
    exitX: 630, exitY: 0,
  },
};

export function getSlot(roomId: RoomId, index: number): { x: number; y: number } {
  const slots = ROOMS[roomId].slots;
  return slots[index % slots.length];
}
