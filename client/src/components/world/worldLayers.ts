/**
 * worldLayers.ts
 *
 * Pure PixiJS layer builders for the virtual office world.
 * Each function receives a pre-allocated Container and populates it.
 * All functions are async because they load sprite sheets on demand.
 *
 * Responsibility split:
 *   buildFloorLayer   — TilingSprite floor per room
 *   buildWallLayer    — wall borders, accent strips, corridor connectors
 *   buildSlotFurniture — permanent beds + desks (always visible for every agent)
 *   buildDecorLayer   — corner/edge decorative props
 */

import {
  Container, Graphics, Text, Texture, TilingSprite, Sprite, Rectangle, Assets,
} from "pixi.js";
import { ROOMS, type RoomId } from "./rooms.config";
import { FLOOR_TILES, FURNITURE } from "./sprites.config";

// ── Helpers ──────────────────────────────────────────────────────────────────

function frameTex(base: Texture, col: number, row: number, cw: number, ch: number): Texture {
  return new Texture({
    source: base.source,
    frame: new Rectangle(Math.floor(col * cw), Math.floor(row * ch), Math.floor(cw), Math.floor(ch)),
  });
}

function placeSprite(
  layer: Container,
  sheet: Texture,
  col: number, row: number,
  cw: number, ch: number,
  scale: number,
  wx: number, wy: number,
  anchorX = 0.5, anchorY = 0.5,
): Sprite {
  const s = new Sprite(frameTex(sheet, col, row, cw, ch));
  s.scale.set(scale);
  s.anchor.set(anchorX, anchorY);
  s.x = wx;
  s.y = wy;
  layer.addChild(s);
  return s;
}

// ── Floor (TilingSprite per room) ─────────────────────────────────────────────

export async function buildFloorLayer(layer: Container): Promise<void> {
  const sheet = await Assets.load(FLOOR_TILES.url);
  const colMap: Record<RoomId, number> = {
    office:    FLOOR_TILES.office,
    bedroom:   FLOOR_TILES.bedroom,
    breakroom: FLOOR_TILES.breakroom,
    clinic:    FLOOR_TILES.clinic,
    beach:     FLOOR_TILES.beach,
  };
  const inset = 8; // strip dark tile border from source PNG
  const cw = FLOOR_TILES.cellW;
  const ch = FLOOR_TILES.cellH;

  (Object.entries(ROOMS) as [RoomId, typeof ROOMS.office][]).forEach(([id, room]) => {
    const col = colMap[id];
    const tileTex = new Texture({
      source: sheet.source,
      frame: new Rectangle(
        Math.floor(col * cw) + inset, inset,
        Math.floor(cw) - inset * 2, Math.floor(ch) - inset * 2,
      ),
    });
    const scale = FLOOR_TILES.tileRenderSize / cw;
    const ts = new TilingSprite({ texture: tileTex, width: room.w, height: room.h });
    ts.tileScale.set(scale);
    ts.x = room.x;
    ts.y = room.y;
    layer.addChild(ts);
  });
}

// ── Walls + corridors (Graphics) ──────────────────────────────────────────────

export function buildWallLayer(layer: Container): void {
  // Room borders
  Object.values(ROOMS).forEach(room => {
    const g = new Graphics();
    // Accent strip at top wall
    g.rect(room.x, room.y, room.w, 10);
    g.fill({ color: room.accentColor, alpha: 0.85 });
    // Wall outline
    g.rect(room.x, room.y, room.w, room.h);
    g.stroke({ color: room.wallColor, width: 5 });
    layer.addChild(g);
  });

  // Corridor connectors (filled rectangles bridging room gaps)
  const corridors: Array<[number, number, number, number, number]> = [
    [778,  248, 66,  24, 0x1e2535], // bedroom ↔ office (horizontal)
    [248,  508, 24,  66, 0x1e1e35], // bedroom ↔ clinic (vertical)
    [1048, 508, 24,  66, 0x1e2535], // office  ↔ breakroom (vertical)
    [688,  743, 66,  24, 0x281a18], // clinic  ↔ breakroom (horizontal)
    [298,  938, 24,  66, 0x1a2e24], // clinic  ↔ beach (vertical)
    [1098, 938, 24,  66, 0x2a1e1a], // breakroom↔ beach (vertical)
  ];
  const g = new Graphics();
  corridors.forEach(([x, y, w, h, color]) => {
    g.rect(x, y, w, h);
    g.fill({ color });
  });
  layer.addChild(g);

  // Room labels
  Object.values(ROOMS).forEach(room => {
    const t = new Text({
      text: room.label,
      style: {
        fontFamily: "Space Mono, monospace",
        fontSize: 11,
        fill: room.accentColor,
        letterSpacing: 2,
      },
    });
    t.alpha = 0.7;
    t.x = room.x + 16;
    t.y = room.y + 16;
    layer.addChild(t);
  });
}

// ── Permanent slot furniture (beds + desks always present) ────────────────────

export async function buildSlotFurniture(layer: Container, agentCount: number): Promise<void> {
  const [bedroomSheet, officeSheet, breakroomSheet] = await Promise.all([
    Assets.load(FURNITURE.bedroom.url),
    Assets.load(FURNITURE.office.url),
    Assets.load(FURNITURE.breakroom.url),
  ]);

  const fb  = FURNITURE.bedroom;
  const fo  = FURNITURE.office;
  const fbr = FURNITURE.breakroom;

  // Bedroom — one single bed per agent slot (always visible)
  for (let i = 0; i < agentCount; i++) {
    const { x, y } = ROOMS.bedroom.slots[i % ROOMS.bedroom.slots.length];
    placeSprite(layer, bedroomSheet, fb.items.singleBed[0], fb.items.singleBed[1], fb.cellW, fb.cellH, 0.072, x, y);
  }

  // Office — one desk per agent slot (always visible)
  for (let i = 0; i < agentCount; i++) {
    const { x, y } = ROOMS.office.slots[i % ROOMS.office.slots.length];
    placeSprite(layer, officeSheet, fo.items.desk[0], fo.items.desk[1], fo.cellW, fo.cellH, 0.095, x, y);
  }

  // Breakroom — couch/beanbag at every breakroom slot
  ROOMS.breakroom.slots.forEach(({ x, y }, i) => {
    const isBean = i % 3 === 2;
    const [col, row] = isBean ? fbr.items.beanbag : fbr.items.sofa;
    placeSprite(layer, breakroomSheet, col, row, fbr.cellW, fbr.cellH, isBean ? 0.065 : 0.08, x, y);
  });
}

// ── Decorative corner/edge props ──────────────────────────────────────────────

export async function buildDecorLayer(layer: Container): Promise<void> {
  const [officeSheet, bedroomSheet, breakroomSheet, clinicSheet, beachSheet] = await Promise.all([
    Assets.load(FURNITURE.office.url),
    Assets.load(FURNITURE.bedroom.url),
    Assets.load(FURNITURE.breakroom.url),
    Assets.load(FURNITURE.clinic.url),
    Assets.load(FURNITURE.beach.url),
  ]);

  const fo  = FURNITURE.office;
  const fb  = FURNITURE.bedroom;
  const fbr = FURNITURE.breakroom;
  const fc  = FURNITURE.clinic;
  const fbc = FURNITURE.beach;

  const o     = ROOMS.office;
  const bed   = ROOMS.bedroom;
  const br    = ROOMS.breakroom;
  const cl    = ROOMS.clinic;
  const beach = ROOMS.beach;

  const p = (sheet: Texture, col: number, row: number, cw: number, ch: number, sc: number, x: number, y: number) =>
    placeSprite(layer, sheet, col, row, cw, ch, sc, x, y);

  // ── Office ──
  p(officeSheet, fo.items.bookshelf[0], fo.items.bookshelf[1], fo.cellW, fo.cellH, 0.09,  o.x + 48,        o.y + 48);
  p(officeSheet, fo.items.whiteboard[0],fo.items.whiteboard[1],fo.cellW, fo.cellH, 0.09,  o.x + 250,       o.y + 38);
  p(officeSheet, fo.items.plant[0],     fo.items.plant[1],     fo.cellW, fo.cellH, 0.085, o.x + o.w - 45,  o.y + 42);
  p(officeSheet, fo.items.cabinet[0],   fo.items.cabinet[1],   fo.cellW, fo.cellH, 0.085, o.x + 48,        o.y + o.h - 45);
  p(officeSheet, fo.items.lamp[0],      fo.items.lamp[1],      fo.cellW, fo.cellH, 0.085, o.x + o.w - 45,  o.y + o.h - 45);
  p(officeSheet, fo.items.bin[0],       fo.items.bin[1],       fo.cellW, fo.cellH, 0.07,  o.x + 108,       o.y + o.h - 42);

  // ── Bedroom ──
  p(bedroomSheet, fb.items.wardrobe[0],  fb.items.wardrobe[1],  fb.cellW, fb.cellH, 0.075, bed.x + bed.w - 45, bed.y + 42);
  p(bedroomSheet, fb.items.nightstand[0],fb.items.nightstand[1],fb.cellW, fb.cellH, 0.07,  bed.x + 42,         bed.y + 42);
  p(bedroomSheet, fb.items.rug[0],       fb.items.rug[1],       fb.cellW, fb.cellH, 0.075, bed.x + bed.w / 2,  bed.y + 195);

  // ── Breakroom ──
  p(breakroomSheet, fbr.items.coffee[0], fbr.items.coffee[1], fbr.cellW, fbr.cellH, 0.08,  br.x + 42,        br.y + 42);
  p(breakroomSheet, fbr.items.fridge[0], fbr.items.fridge[1], fbr.cellW, fbr.cellH, 0.08,  br.x + br.w - 42, br.y + 42);
  p(breakroomSheet, fbr.items.table[0],  fbr.items.table[1],  fbr.cellW, fbr.cellH, 0.09,  br.x + br.w / 2,  br.y + br.h / 2);

  // ── Clinic ──
  p(clinicSheet, fc.items.cabinet[0], fc.items.cabinet[1], fc.cellW, fc.cellH, 0.08, cl.x + cl.w - 42, cl.y + 42);
  p(clinicSheet, fc.items.desk[0],    fc.items.desk[1],    fc.cellW, fc.cellH, 0.08, cl.x + 42,        cl.y + 42);

  // ── Beach — palms between chair slots, umbrellas, cooler ──
  [270, 485, 700, 915, 1130, 1345].forEach(px =>
    p(beachSheet, fbc.items.palm[0],     fbc.items.palm[1],     fbc.cellW, fbc.cellH, 0.075, beach.x + px,        beach.y + 38));
  p(beachSheet, fbc.items.umbrella[0],   fbc.items.umbrella[1], fbc.cellW, fbc.cellH, 0.08,  beach.x + 390,       beach.y + 162);
  p(beachSheet, fbc.items.umbrella[0],   fbc.items.umbrella[1], fbc.cellW, fbc.cellH, 0.08,  beach.x + 1110,      beach.y + 155);
  p(beachSheet, fbc.items.cooler[0],     fbc.items.cooler[1],   fbc.cellW, fbc.cellH, 0.065, beach.x + 1440,      beach.y + 162);
}
