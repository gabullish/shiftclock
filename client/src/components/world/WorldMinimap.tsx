import { useEffect, useRef } from "react";
import { ROOMS, WORLD_W, WORLD_H, type RoomId } from "./rooms.config";
import type { AgentWorldData } from "./useWorldState";

const SCALE = 0.095;
const W = Math.round(WORLD_W * SCALE);
const H = Math.round(WORLD_H * SCALE);

const ROOM_COLORS: Record<RoomId, string> = {
  office: "#1e4a7a",
  bedroom: "#2a1e5a",
  clinic: "#1a4a30",
  breakroom: "#4a2a18",
  beach: "#1a5070",
};

interface MinimapProps {
  agentData: AgentWorldData[];
  cameraX: number;
  cameraY: number;
  viewW: number;
  viewH: number;
}

export function WorldMinimap({ agentData, cameraX, cameraY, viewW, viewH }: MinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, W, H);

    // Background
    ctx.fillStyle = "#0c0f17";
    ctx.fillRect(0, 0, W, H);

    // Rooms
    Object.values(ROOMS).forEach(room => {
      ctx.fillStyle = ROOM_COLORS[room.id];
      ctx.fillRect(
        room.x * SCALE, room.y * SCALE,
        room.w * SCALE, room.h * SCALE
      );
      ctx.strokeStyle = room.accentColor.toString(16).padStart(6, "0");
      ctx.strokeStyle = `#${room.accentColor.toString(16).padStart(6, "0")}`;
      ctx.lineWidth = 0.5;
      ctx.strokeRect(
        room.x * SCALE, room.y * SCALE,
        room.w * SCALE, room.h * SCALE
      );
    });

    // Agent dots
    agentData.forEach((d, i) => {
      const slot = ROOMS[d.state]?.slots[i % (ROOMS[d.state]?.slots.length || 1)];
      if (!slot) return;
      const color = d.agent.color || "#888888";
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(slot.x * SCALE, slot.y * SCALE, 2.5, 0, Math.PI * 2);
      ctx.fill();
    });

    // Viewport rect
    const vx = -cameraX * SCALE;
    const vy = -cameraY * SCALE;
    const vw = viewW * SCALE;
    const vh = viewH * SCALE;
    ctx.strokeStyle = "rgba(255,255,255,0.4)";
    ctx.lineWidth = 1;
    ctx.strokeRect(vx, vy, vw, vh);

  }, [agentData, cameraX, cameraY, viewW, viewH]);

  return (
    <div className="absolute bottom-4 right-4 rounded-lg overflow-hidden border border-white/10 shadow-xl z-10"
      style={{ width: W, height: H, background: "#0c0f17" }}>
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        style={{ imageRendering: "pixelated", display: "block" }}
      />
      <div className="absolute top-1 left-1.5 text-[7px] text-white/30 font-mono tracking-widest uppercase">
        MAP
      </div>
    </div>
  );
}
