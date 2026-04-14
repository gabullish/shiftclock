export type RoomId = "office" | "bedroom" | "clinic" | "breakroom" | "beach";

export const WORLD_W = 1620;
export const WORLD_H = 1260;

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
  // ── Office: top-right, 750×480 ─────────────────────────────
  // Slots: 4 cols × 3 rows = 12 — inset 100px from all walls
  office: {
    id: "office",
    label: "Office",
    x: 840, y: 30, w: 750, h: 480,
    floorColor: 0x1e2d42,
    wallColor: 0x14213a,
    accentColor: 0x3a7bd5,
    labelColor: "#6aaef8",
    slots: makeSlots(840, 30, 4, 3, 100, 100, 175, 140),
    exitX: 0, exitY: 240,
  },

  // ── Bedroom: top-left, 750×480 ─────────────────────────────
  // Slots: 4 cols × 3 rows = 12 — same spacing as office
  bedroom: {
    id: "bedroom",
    label: "Bedroom",
    x: 30, y: 30, w: 750, h: 480,
    floorColor: 0x1e1e38,
    wallColor: 0x141430,
    accentColor: 0x7b5ea7,
    labelColor: "#b09ed4",
    slots: makeSlots(30, 30, 4, 3, 100, 100, 175, 140),
    exitX: 750, exitY: 240,
  },

  // ── Clinic: mid-left, 660×370 ──────────────────────────────
  // Slots: 3 cols × 2 rows = 6 — wide spacing for hospital beds
  clinic: {
    id: "clinic",
    label: "Clinic",
    x: 30, y: 570, w: 660, h: 370,
    floorColor: 0x1a2e24,
    wallColor: 0x112018,
    accentColor: 0x4ecba1,
    labelColor: "#7de8c3",
    slots: makeSlots(30, 570, 3, 2, 110, 80, 210, 170),
    exitX: 660, exitY: 185,
  },

  // ── Break room: mid-right, 840×370 ─────────────────────────
  // Slots: 4 cols × 2 rows = 8 — couch spots
  breakroom: {
    id: "breakroom",
    label: "Break Room",
    x: 750, y: 570, w: 840, h: 370,
    floorColor: 0x2a1e1a,
    wallColor: 0x1e1210,
    accentColor: 0xe07b54,
    labelColor: "#f0a080",
    slots: makeSlots(750, 570, 4, 2, 100, 80, 200, 175),
    exitX: 0, exitY: 185,
  },

  // ── Beach: bottom strip, 1560×230 ──────────────────────────
  // Slots: 7 cols × 1 row = 7 — single row of loungers
  beach: {
    id: "beach",
    label: "Beach",
    x: 30, y: 1000, w: 1560, h: 230,
    floorColor: 0x1a4a5e,
    wallColor: 0x0e3a50,
    accentColor: 0xf4d03f,
    labelColor: "#f7e07a",
    slots: makeSlots(30, 1000, 7, 1, 130, 110, 215, 0),
    exitX: 780, exitY: 0,
  },
};

export function getSlot(roomId: RoomId, index: number): { x: number; y: number } {
  const slots = ROOMS[roomId].slots;
  return slots[index % slots.length];
}
