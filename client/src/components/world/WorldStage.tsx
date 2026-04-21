/**
 * WorldStage.tsx
 *
 * Orchestrates the PixiJS canvas for the virtual office world view.
 * Responsibilities:
 *   - Initialize and tear down the PixiJS Application
 *   - Stack display layers in correct z-order
 *   - Run the animation ticker (agent walking + idle animations)
 *   - Handle drag-to-pan camera
 *   - React to agentData changes and trigger walk transitions
 *
 * Heavy lifting is delegated to:
 *   worldLayers.ts  — floor, wall, furniture builders
 *   worldPaths.ts   — corridor waypoint graph
 *   sprites.config.ts / rooms.config.ts — data definitions
 */

import { useEffect, useRef, useCallback } from "react";
import {
  Application, Container, Sprite, Text, Texture, Rectangle, Assets, Ticker,
} from "pixi.js";
import { ROOMS, WORLD_W, WORLD_H, getSlot, type RoomId } from "./rooms.config";
import { CHAR_BASE, CHAR_STATES } from "./sprites.config";
import { buildFloorLayer, buildWallLayer, buildSlotFurniture, buildDecorLayer } from "./worldLayers";
import { getWalkPath, type WorldPoint } from "./worldPaths";
import type { AgentWorldData } from "./useWorldState";

// ── Constants ─────────────────────────────────────────────────────────────────

const WALK_SPEED   = 150;  // px / second
const WALK_FPS     = 8;    // walk animation frames per second
const LABEL_STYLE  = {
  fontFamily: "Space Mono, monospace",
  fontSize: 11,
  fill: 0xffffff,
  stroke: { color: 0x000000, width: 4 },
  dropShadow: { color: 0x000000, blur: 3, distance: 1, alpha: 1 },
  align: "center" as const,
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface AgentSprite {
  container: Container;
  body: Sprite;
  label: Text;
  // Position
  x: number;
  y: number;
  // Walk queue — list of WorldPoints to walk through in order
  waypoints: WorldPoint[];
  // Room tracking
  currentRoom: RoomId;
  targetRoom: RoomId;
  // Meta
  agentIndex: number;       // stable identity, drives idle float phase — NEVER mutate
  slotIndex: number;        // which slot in currentRoom/targetRoom the sprite occupies
  variant: number;          // 0–3 character skin variant
  animTick: number;
  walkFrame: number;
  walkFrameTimer: number;
  isWalking: boolean;
  isSpecialState: boolean;  // clinic or beach → char_states sprite
}

// ── Sprite texture helpers ─────────────────────────────────────────────────────

function frameTex(base: Texture, col: number, row: number, cw: number, ch: number): Texture {
  return new Texture({
    source: base.source,
    frame: new Rectangle(Math.floor(col * cw), Math.floor(row * ch), Math.floor(cw), Math.floor(ch)),
  });
}

function idleTex(base: Texture, variant: number): Texture {
  return frameTex(base, variant * CHAR_BASE.framesPerVariant + 1, CHAR_BASE.rowDown, CHAR_BASE.cellW, CHAR_BASE.cellH);
}

function walkTex(base: Texture, variant: number, frame: number, rowOverride?: number): Texture {
  const row = rowOverride ?? CHAR_BASE.rowWalkDown;
  return frameTex(base, variant * CHAR_BASE.framesPerVariant + (frame % CHAR_BASE.framesPerVariant), row, CHAR_BASE.cellW, CHAR_BASE.cellH);
}

function stateTex(states: Texture, room: RoomId, tick: number): Texture {
  const map: Record<RoomId, [number, number][]> = {
    office:    [CHAR_STATES.office,    CHAR_STATES.office2],
    bedroom:   [CHAR_STATES.bedroom,   CHAR_STATES.bedroom2],
    breakroom: [CHAR_STATES.breakroom, CHAR_STATES.breakroom2],
    beach:     [CHAR_STATES.beach,     CHAR_STATES.beach],
    clinic:    [CHAR_STATES.clinic,    CHAR_STATES.clinic],
  };
  const frames = map[room];
  const [col, row] = frames[Math.floor(tick / 1.5) % frames.length];
  return frameTex(states, col, row, CHAR_STATES.cellW, CHAR_STATES.cellH);
}

const isSpecial = (r: RoomId) => r === "clinic" || r === "beach";

// ── Agent sprite factory ───────────────────────────────────────────────────────

function makeAgentSprite(
  d: AgentWorldData,
  idx: number,
  base: Texture,
  states: Texture,
): Omit<AgentSprite, "x" | "y"> {
  const container = new Container();
  const variant   = idx % CHAR_BASE.variants;
  const special   = isSpecial(d.state);

  const body = new Sprite(special ? stateTex(states, d.state, 0) : idleTex(base, variant));
  body.scale.set(special ? CHAR_STATES.renderScale : CHAR_BASE.renderScale);
  body.anchor.set(0.5, special ? 0.85 : 1);

  const label = new Text({ text: d.agent.name, style: LABEL_STYLE });
  label.anchor.set(0.5, 0);
  label.x = 0;
  label.y = special ? Math.ceil(CHAR_STATES.cellH * CHAR_STATES.renderScale * 0.15) + 4 : 4;

  container.addChild(body, label);

  return {
    container, body, label,
    waypoints: [],
    currentRoom: d.state,
    targetRoom:  d.state,
    agentIndex:  idx,
    slotIndex:   idx,
    variant,
    animTick:        0,
    walkFrame:       0,
    walkFrameTimer:  0,
    isWalking:       false,
    isSpecialState:  special,
  };
}

// ── Direction helpers ─────────────────────────────────────────────────────────

/** Returns the dominant direction between two points. */
function direction(from: WorldPoint, to: WorldPoint): "left" | "right" | "up" | "down" {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? "right" : "left";
  return dy > 0 ? "down" : "up";
}

function applyWalkDirection(sprite: AgentSprite, base: Texture, dir: "left" | "right" | "up" | "down") {
  const isHoriz = dir === "left" || dir === "right";
  const row = isHoriz ? CHAR_BASE.rowWalkRight : CHAR_BASE.rowWalkDown;
  sprite.body.texture = walkTex(base, sprite.variant, sprite.walkFrame, row);
  sprite.body.scale.set(CHAR_BASE.renderScale);
  sprite.body.anchor.set(0.5, 1);
  // Mirror sprite when walking left
  sprite.body.scale.x = dir === "left" ? -CHAR_BASE.renderScale : CHAR_BASE.renderScale;
}

// ── Component ─────────────────────────────────────────────────────────────────

export interface WorldStageProps {
  agentData: AgentWorldData[];
  onCameraChange?: (x: number, y: number) => void;
}

export function WorldStage({ agentData, onCameraChange }: WorldStageProps) {
  const mountRef       = useRef<HTMLDivElement>(null);
  const appRef         = useRef<Application | null>(null);
  const worldRef       = useRef<Container | null>(null);
  const spritesRef     = useRef<Map<number, AgentSprite>>(new Map());
  const sheetsRef      = useRef<{ base: Texture; states: Texture } | null>(null);
  const cameraRef      = useRef({ x: -100, y: -50, dragging: false, lastX: 0, lastY: 0 });
  const agentDataRef   = useRef<AgentWorldData[]>(agentData);
  const tickerFnRef    = useRef<((t: Ticker) => void) | null>(null);

  agentDataRef.current = agentData;

  // ── Initialization ──────────────────────────────────────────────────────────

  const init = useCallback(async () => {
    if (!mountRef.current || appRef.current) return;

    const app = new Application();
    await app.init({
      width:           mountRef.current.clientWidth || 800,
      height:          mountRef.current.clientHeight || 600,
      backgroundColor: 0x0c0f17,
      resolution:      window.devicePixelRatio || 1,
      autoDensity:     true,
      antialias:       false, // crisp pixel art
    });
    appRef.current = app;
    mountRef.current.appendChild(app.canvas);
    app.canvas.style.display = "block";

    const world = new Container();
    world.x = cameraRef.current.x;
    world.y = cameraRef.current.y;
    worldRef.current = world;
    app.stage.addChild(world);

    // ── Load character sheets (blocking — needed before agents spawn) ────────
    const [base, states] = await Promise.all([
      Assets.load(CHAR_BASE.url),
      Assets.load(CHAR_STATES.url),
    ]);
    sheetsRef.current = { base, states };

    // ── Layer stack — order matters for z-index ──────────────────────────────
    const floorLayer     = new Container();
    const wallLayer      = new Container();
    const slotFurnLayer  = new Container();
    const decorLayer     = new Container();
    const agentLayer     = new Container();

    world.addChild(floorLayer);    // 1. floor tiles
    world.addChild(wallLayer);     // 2. walls + corridors + labels
    world.addChild(slotFurnLayer); // 3. permanent beds + desks (below agents)
    world.addChild(decorLayer);    // 4. corner decorations (below agents)
    world.addChild(agentLayer);    // 5. agents always on top

    // Populate layers (floor + walls are sync-safe, furniture is async)
    buildWallLayer(wallLayer);
    buildFloorLayer(floorLayer).catch(console.error);
    buildSlotFurniture(slotFurnLayer, agentDataRef.current.length).catch(console.error);
    buildDecorLayer(decorLayer).catch(console.error);

    // ── Spawn agent sprites ──────────────────────────────────────────────────
    const roomCounts: Partial<Record<RoomId, number>> = {};
    agentDataRef.current.forEach(d => {
      const idx = roomCounts[d.state] ?? 0;
      roomCounts[d.state] = idx + 1;
      const slot = getSlot(d.state, idx);
      const sd   = makeAgentSprite(d, idx, base, states);
      const sp: AgentSprite = { ...sd, x: slot.x, y: slot.y };
      sp.container.x = slot.x;
      sp.container.y = slot.y;
      agentLayer.addChild(sp.container);
      spritesRef.current.set(d.agent.id, sp);
    });

    // ── Animation ticker ─────────────────────────────────────────────────────
    const tick = (ticker: Ticker) => {
      const dt     = ticker.deltaMS / 1000;
      const sheets = sheetsRef.current;
      if (!sheets) return;

      spritesRef.current.forEach(sp => {
        sp.animTick += dt;

        if (sp.waypoints.length > 0) {
          // ── Walking — advance along waypoint queue ────────────────────────
          sp.isWalking = true;
          const target = sp.waypoints[0];
          const dx     = target.x - sp.x;
          const dy     = target.y - sp.y;
          const dist   = Math.hypot(dx, dy);

          // Guard: waypoint coincident with current position → pop it, skip frame
          if (dist < 0.001) {
            sp.waypoints.shift();
            return; // forEach callback: skip to next sprite
          }

          // Update walk animation frame
          sp.walkFrameTimer += dt;
          if (sp.walkFrameTimer >= 1 / WALK_FPS) {
            sp.walkFrameTimer = 0;
            sp.walkFrame      = (sp.walkFrame + 1) % CHAR_BASE.framesPerVariant;
          }

          // Direction-aware sprite
          const dir = direction({ x: sp.x, y: sp.y }, target);
          applyWalkDirection(sp, sheets.base, dir);

          const step = Math.min(WALK_SPEED * dt, dist);
          sp.x += (dx / dist) * step;
          sp.y += (dy / dist) * step;
          sp.container.x = sp.x;
          sp.container.y = sp.y + Math.sin(sp.animTick * 10) * 1.5; // foot-step bob

          // Reached this waypoint — pop and continue
          if (dist <= step + 0.5) {
            sp.x = target.x;
            sp.y = target.y;
            sp.waypoints.shift();

            // All waypoints consumed → arrived at destination
            if (sp.waypoints.length === 0) {
              sp.isWalking    = false;
              sp.currentRoom  = sp.targetRoom;
              sp.isSpecialState = isSpecial(sp.currentRoom);

              // Switch to correct idle sprite for new room
              if (sp.isSpecialState) {
                sp.body.texture = stateTex(sheets.states, sp.currentRoom, 0);
                sp.body.scale.set(CHAR_STATES.renderScale);
                sp.body.anchor.set(0.5, 0.85);
                sp.body.scale.x = CHAR_STATES.renderScale; // reset mirror
                sp.label.y = Math.ceil(CHAR_STATES.cellH * CHAR_STATES.renderScale * 0.15) + 4;
              } else {
                sp.body.texture = idleTex(sheets.base, sp.variant);
                sp.body.scale.set(CHAR_BASE.renderScale);
                sp.body.anchor.set(0.5, 1);
                sp.body.scale.x = CHAR_BASE.renderScale; // reset mirror
                sp.label.y = 4;
              }
            }
          }
        } else {
          // ── Idle animations ───────────────────────────────────────────────
          sp.isWalking = false;

          if (sp.isSpecialState) {
            // Animate clinic/beach frames
            sp.body.texture = stateTex(sheets.states, sp.currentRoom, sp.animTick);
          } else {
            // Gentle scale breath
            const bob = 1 + Math.sin(sp.animTick * 1.8 + sp.agentIndex * 0.7) * 0.025;
            sp.body.scale.x = CHAR_BASE.renderScale * bob;
            sp.body.scale.y = CHAR_BASE.renderScale * bob;
          }
          // Vertical float
          sp.container.x = sp.x;
          sp.container.y = sp.y + Math.sin(sp.animTick * 1.5 + sp.agentIndex * 0.8) * 1.5;
        }
      });
    };
    tickerFnRef.current = tick;
    app.ticker.add(tick);

    // ── Drag-to-pan ──────────────────────────────────────────────────────────
    app.stage.eventMode = "static";
    app.stage.hitArea   = app.screen;

    app.stage.on("pointerdown", e => {
      cameraRef.current.dragging = true;
      cameraRef.current.lastX   = e.globalX;
      cameraRef.current.lastY   = e.globalY;
    });
    app.stage.on("pointermove", e => {
      if (!cameraRef.current.dragging) return;
      const dx = e.globalX - cameraRef.current.lastX;
      const dy = e.globalY - cameraRef.current.lastY;
      cameraRef.current.lastX = e.globalX;
      cameraRef.current.lastY = e.globalY;
      cameraRef.current.x = Math.min(100, Math.max(-(WORLD_W - 200), cameraRef.current.x + dx));
      cameraRef.current.y = Math.min(100, Math.max(-(WORLD_H - 200), cameraRef.current.y + dy));
      world.x = cameraRef.current.x;
      world.y = cameraRef.current.y;
      onCameraChange?.(cameraRef.current.x, cameraRef.current.y);
    });
    app.stage.on("pointerup",        () => { cameraRef.current.dragging = false; });
    app.stage.on("pointerupoutside", () => { cameraRef.current.dragging = false; });

    // ── Resize ───────────────────────────────────────────────────────────────
    const ro = new ResizeObserver(() => {
      if (mountRef.current && appRef.current) {
        app.renderer.resize(mountRef.current.clientWidth, mountRef.current.clientHeight);
        app.stage.hitArea = app.screen;
      }
    });
    if (mountRef.current) ro.observe(mountRef.current);

  }, []); // eslint-disable-line

  useEffect(() => {
    init();
    return () => {
      if (appRef.current && tickerFnRef.current) {
        appRef.current.ticker.remove(tickerFnRef.current);
      }
      appRef.current?.destroy(true);
      appRef.current = null;
      spritesRef.current.clear();
    };
  }, [init]);

  // ── React to real-time state changes ────────────────────────────────────────

  useEffect(() => {
    const sprites = spritesRef.current;
    const sheets  = sheetsRef.current;
    if (sprites.size === 0 || !sheets) return;

    // Pre-compute occupancy per room, counting BOTH settled agents (in currentRoom)
    // AND in-flight walkers (toward targetRoom). This prevents slot collisions when
    // multiple agents are moving to the same room at once.
    const occupied: Partial<Record<RoomId, Set<number>>> = {};
    const claimSlot = (room: RoomId, idx: number) => {
      (occupied[room] ??= new Set()).add(idx);
    };
    const nextFreeSlot = (room: RoomId): number => {
      const taken = occupied[room] ?? new Set<number>();
      let i = 0;
      while (taken.has(i)) i++;
      return i;
    };

    sprites.forEach(sp => {
      if (sp.isWalking) claimSlot(sp.targetRoom, sp.slotIndex);
      else              claimSlot(sp.currentRoom, sp.slotIndex);
    });

    agentData.forEach(d => {
      const sp = sprites.get(d.agent.id);
      if (!sp) return;

      const newRoom = d.state;

      // Needs to move? (not already walking, not already in target room)
      if (sp.currentRoom !== newRoom && !sp.isWalking) {
        // Release old slot, claim a new one in the destination room
        occupied[sp.currentRoom]?.delete(sp.slotIndex);
        const destIdx = nextFreeSlot(newRoom);
        claimSlot(newRoom, destIdx);

        sp.slotIndex = destIdx;   // NOTE: only slotIndex changes; agentIndex stays stable
        sp.targetRoom = newRoom;

        const targetSlot = getSlot(newRoom, destIdx);
        sp.waypoints = getWalkPath(
          sp.currentRoom,
          newRoom,
          { x: sp.x, y: sp.y },
          targetSlot,
        );

        // Switch immediately to walk sprite (direction set in ticker on first frame)
        sp.body.texture  = walkTex(sheets.base, sp.variant, 0);
        sp.body.scale.set(CHAR_BASE.renderScale);
        sp.body.anchor.set(0.5, 1);
        sp.body.scale.x  = CHAR_BASE.renderScale;
        sp.label.y       = 4;
      }
    });
  }, [agentData]);

  return (
    <div
      ref={mountRef}
      className="w-full h-full"
      style={{ cursor: "grab", imageRendering: "pixelated" }}
    />
  );
}
