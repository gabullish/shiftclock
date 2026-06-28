export type RoomId = "office" | "bedroom" | "clinic" | "breakroom" | "beach";

// World = the new map image's native pixel size. The background is drawn at
// WORLD_W × WORLD_H, so every seat/door coordinate below is in image pixels
// (origin top-left, y down) and lands 1:1 on the artwork.
export const WORLD_W = 1380;
export const WORLD_H = 1140;

export type Facing = "north" | "south" | "east" | "west";

export interface Slot { x: number; y: number; facing: Facing }

export interface RoomDef {
  id: RoomId;
  label: string;
  // Approximate room rectangle (derived from the image) — used for the minimap
  // and for placing overflow agents who don't get a seat. Seats/doors are exact.
  x: number;
  y: number;
  w: number;
  h: number;
  floorColor: number;
  wallColor: number;
  accentColor: number;
  labelColor: string;
  // Exact furniture centers (a character sits/stands on each). Seats fill in order;
  // when occupants exceed seats, extras get generated standing spots (see getSlot).
  slots: Slot[];
  // Exact door center where the room opens into the central hallway.
  door: { x: number; y: number };
}

// App agent-states map onto these rooms:
//   office = on shift (workstation) · bedroom = off shift · clinic = sick
//   breakroom = on break · beach = vacation
export const ROOMS: Record<RoomId, RoomDef> = {
  // ── Workstation (top-right) — on shift ──
  office: {
    id: "office", label: "Workstation",
    x: 715, y: 40, w: 635, h: 490,
    floorColor: 0x1e2d42, wallColor: 0x14213a, accentColor: 0x3a7bd5, labelColor: "#6aaef8",
    slots: [
      { x: 868, y: 146, facing: "north" },
      { x: 1016, y: 144, facing: "north" },
      { x: 1173, y: 141, facing: "north" },
      { x: 868, y: 324, facing: "north" },
      { x: 1016, y: 322, facing: "north" },
      { x: 1174, y: 325, facing: "north" },
    ],
    door: { x: 734, y: 302 },
  },

  // ── Bedroom (top-left) — off shift ──
  bedroom: {
    id: "bedroom", label: "Bedroom",
    x: 30, y: 40, w: 580, h: 490,
    floorColor: 0x1e1e38, wallColor: 0x141430, accentColor: 0x7b5ea7, labelColor: "#b09ed4",
    slots: [
      { x: 145, y: 208, facing: "south" },
      { x: 322, y: 205, facing: "south" },
      { x: 501, y: 208, facing: "south" },
      { x: 153, y: 381, facing: "south" },
      { x: 322, y: 384, facing: "south" },
      { x: 505, y: 381, facing: "south" },
    ],
    door: { x: 625, y: 298 },
  },

  // ── Clinic (bottom-left) — sick leave ──
  clinic: {
    id: "clinic", label: "Clinic",
    x: 30, y: 600, w: 410, h: 500,
    floorColor: 0x1a2e24, wallColor: 0x112018, accentColor: 0x4ecba1, labelColor: "#7de8c3",
    slots: [
      { x: 101, y: 890, facing: "south" },
      { x: 218, y: 889, facing: "south" },
      { x: 335, y: 889, facing: "south" },
    ],
    door: { x: 394, y: 623 },
  },

  // ── Break room (bottom-middle) — on break ──
  // The two sofa seats are exact (from the mapping). The four table seats around
  // the round table are eyeballed from the image — easy to refine later.
  breakroom: {
    id: "breakroom", label: "Break Room",
    x: 455, y: 690, w: 315, h: 410,
    floorColor: 0x2a1e1a, wallColor: 0x1e1210, accentColor: 0xe07b54, labelColor: "#f0a080",
    slots: [
      { x: 506, y: 872, facing: "south" },
      { x: 550, y: 874, facing: "south" },
      { x: 645, y: 905, facing: "south" },
      { x: 585, y: 958, facing: "east" },
      { x: 705, y: 958, facing: "west" },
      { x: 645, y: 1012, facing: "north" },
    ],
    door: { x: 679, y: 706 },
  },

  // ── Vacation (bottom-right) — on vacation ──
  beach: {
    id: "beach", label: "Vacation",
    x: 800, y: 600, w: 550, h: 500,
    floorColor: 0x1a4a5e, wallColor: 0x0e3a50, accentColor: 0xf4d03f, labelColor: "#f7e07a",
    slots: [
      { x: 935, y: 1011, facing: "south" },
      { x: 1024, y: 1014, facing: "south" },
      { x: 1125, y: 1016, facing: "south" },
      { x: 1221, y: 1009, facing: "south" },
    ],
    door: { x: 977, y: 623 },
  },
};

/**
 * Position for the agent at `index` in a room. Seats fill first (one agent per
 * seat — no overlap). When occupants exceed seats, extras get unique standing
 * spots laid out along the lower interior of the room, so nobody is ever drawn
 * on top of another agent or off the artwork. No modulo — every index is unique.
 */
export function getSlot(roomId: RoomId, index: number): { x: number; y: number } {
  const room = ROOMS[roomId];
  if (index < room.slots.length) {
    const s = room.slots[index];
    return { x: s.x, y: s.y };
  }
  const overflow = index - room.slots.length;
  const colW = 70;
  const cols = Math.max(1, Math.floor((room.w - 80) / colW));
  const col = overflow % cols;
  const row = Math.floor(overflow / cols);
  return {
    x: room.x + 45 + col * colW,
    y: room.y + room.h - 55 - row * 60,
  };
}
