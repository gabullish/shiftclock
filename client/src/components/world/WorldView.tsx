import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { WorldStage } from "@/components/world/WorldStage";
import { WorldMinimap } from "@/components/world/WorldMinimap";
import { useWorldState } from "@/components/world/useWorldState";
import { ROOMS, type RoomId } from "@/components/world/rooms.config";
import { useAdminMode } from "@/hooks/use-admin-mode";
import { apiRequest } from "@/lib/queryClient";

const STATE_LABELS: Record<RoomId, { icon: string; label: string; color: string }> = {
  office: { icon: "🖥️", label: "On Shift", color: "#6aaef8" },
  bedroom: { icon: "🛏", label: "Off Shift", color: "#b09ed4" },
  clinic: { icon: "🏥", label: "Sick Leave", color: "#7de8c3" },
  breakroom: { icon: "☕", label: "On Break", color: "#f0a080" },
  beach: { icon: "🏖️", label: "Vacation", color: "#f7e07a" },
};

export default function WorldView() {
  const agentData = useWorldState();
  const [camera, setCamera] = useState({ x: -200, y: -80 });
  const containerRef = useRef<HTMLDivElement>(null);
  const isAdmin = useAdminMode();
  const queryClient = useQueryClient();

  const viewW = containerRef.current?.clientWidth ?? 800;
  const viewH = containerRef.current?.clientHeight ?? 600;

  // Count agents per state for legend
  const stateCounts = agentData.reduce((acc, d) => {
    acc[d.state] = (acc[d.state] ?? 0) + 1;
    return acc;
  }, {} as Partial<Record<RoomId, number>>);

  // Query for existing background image
  const { data: bgData } = useQuery<{ imageData: string } | null>({
    queryKey: ["/api/world/background"],
    queryFn: async () => {
      try {
        const res = await fetch("/api/world/background");
        if (res.status === 404) return null;
        if (!res.ok) return null;
        return res.json();
      } catch {
        return null;
      }
    },
    retry: false,
    staleTime: 60 * 1000,
  });

  // DB image takes priority; fall back to the static pre-shipped map
  const backgroundImageUrl = bgData?.imageData ?? "/map-background.png";

  // Upload mutation
  const uploadMutation = useMutation({
    mutationFn: async (imageData: string) => {
      const res = await apiRequest("POST", "/api/world/background", { imageData });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/world/background"] });
    },
  });

  // Remove mutation
  const removeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", "/api/world/background");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/world/background"] });
    },
  });

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      uploadMutation.mutate(dataUrl);
    };
    reader.readAsDataURL(file);
    // Reset input so same file can be re-uploaded
    e.target.value = "";
  }, [uploadMutation]);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#0c0f17]">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/5 shrink-0">
        <div>
          <h1 className="text-sm font-semibold text-white/80 tracking-wide">Virtual Office</h1>
          <p className="text-[10px] text-white/30 font-mono mt-0.5">
            {agentData.length} agents · drag to pan
          </p>
        </div>
        {/* State legend */}
        <div className="flex items-center gap-3 flex-wrap justify-end">
          {(Object.keys(STATE_LABELS) as RoomId[]).map(state => {
            const count = stateCounts[state] ?? 0;
            if (count === 0) return null;
            const { icon, label, color } = STATE_LABELS[state];
            return (
              <div key={state} className="flex items-center gap-1 text-[10px] font-mono" style={{ color }}>
                <span>{icon}</span>
                <span>{count}</span>
                <span className="text-white/30 hidden sm:inline">{label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Canvas area */}
      <div ref={containerRef} className="relative flex-1 min-h-0 overflow-hidden">
        <WorldStage
          agentData={agentData}
          backgroundImageUrl={backgroundImageUrl ?? undefined}
          onCameraChange={(x, y) => setCamera({ x, y })}
        />
        <WorldMinimap
          agentData={agentData}
          cameraX={camera.x}
          cameraY={camera.y}
          viewW={viewW}
          viewH={viewH}
        />

        {/* Hint overlay (fades quickly) */}
        <div className="absolute top-3 left-1/2 -translate-x-1/2 text-[10px] text-white/20 font-mono pointer-events-none">
          drag to navigate · agents move when status changes
        </div>

        {/* Admin toolbar — upload/remove background map */}
        {isAdmin && (
          <div className="absolute top-2 right-2 flex flex-row items-center gap-1 z-10">
            <a
              href="/map-reference.svg"
              download="map-reference.svg"
              className="px-2 py-1 text-[10px] font-mono border border-white/20 rounded text-white/60 hover:text-white/90 hover:border-white/40 bg-black/40 no-underline"
            >
              📥 Reference
            </a>
            {bgData?.imageData && (
              <button
                onClick={() => removeMutation.mutate()}
                disabled={removeMutation.isPending}
                className="px-2 py-1 text-[10px] font-mono border border-red-500/30 rounded text-red-400/70 hover:text-red-300 hover:border-red-400/50 bg-black/40 disabled:opacity-50"
              >
                {removeMutation.isPending ? "…" : "Remove map"}
              </button>
            )}
            <label className="px-2 py-1 text-[10px] font-mono border border-white/20 rounded text-white/60 hover:text-white/90 hover:border-white/40 bg-black/40 cursor-pointer">
              {uploadMutation.isPending ? "Uploading…" : "Upload map"}
              <input
                type="file"
                accept="image/png"
                className="hidden"
                onChange={handleFileChange}
                disabled={uploadMutation.isPending}
              />
            </label>
          </div>
        )}
      </div>
    </div>
  );
}
