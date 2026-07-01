// 🚓 Police Hour — Officer Jakov's break-oversight cameo.
//
// When the logged-in agent's break is ~10s from auto-ending, Officer Jakov
// drives in, flips on the siren, and parks bottom-left. He does NOT leave on a
// timer — he sits there (replaying a short siren whenever you return to the tab)
// until you click him to send him off. A manual trigger (the badge by the logo)
// dispatches the same "shiftclock:police-hour" event for testing/fun.
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Agent } from "@shared/schema";
import { useAgentSession } from "@/hooks/use-agent-session";

const BREAK_DURATION_MS = 30 * 60 * 1000;   // matches the server's 30-min break
const WARN_LEAD_MS      = 10 * 1000;         // appear 10s before it auto-ends

type Phase = "idle" | "shown" | "leaving";

export default function PoliceHour() {
  const agentSession = useAgentSession();
  const { data: agents = [] } = useQuery<Agent[]>({ queryKey: ["/api/agents"] });

  const [phase, setPhase] = useState<Phase>("idle");
  const [slid, setSlid] = useState(false);

  const audioRef = useRef<AudioContext | null>(null);
  const sirenStop = useRef<(() => void) | null>(null);
  // Guard so a single break only summons Jakov once (keyed by breakActiveAt).
  const firedFor = useRef<string | null>(null);

  // ── Siren (Web Audio, no asset needed) — a short, gentle two-tone "woop". ──
  const playSiren = useCallback(() => {
    try {
      const c = audioRef.current ?? (audioRef.current = new (window.AudioContext || (window as any).webkitAudioContext)());
      if (c.state === "suspended") void c.resume();
      const now = c.currentTime;
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = "sawtooth";
      const cycle = 0.5, cycles = 4;
      for (let i = 0; i < cycles; i++) {
        const t = now + i * cycle;
        osc.frequency.setValueAtTime(660, t);
        osc.frequency.linearRampToValueAtTime(960, t + cycle / 2);
        osc.frequency.linearRampToValueAtTime(660, t + cycle);
      }
      const end = now + cycles * cycle;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(0.11, now + 0.05);   // kept low — not a jumpscare
      gain.gain.setValueAtTime(0.11, end - 0.12);
      gain.gain.linearRampToValueAtTime(0.0001, end);
      osc.connect(gain).connect(c.destination);
      osc.start(now);
      osc.stop(end + 0.05);
      sirenStop.current = () => { try { osc.stop(); } catch { /* already stopped */ } };
    } catch { /* audio not available — visuals still work */ }
  }, []);

  const slideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback(() => {
    setPhase("shown");
    setSlid(false);
    // Flip to the on-screen position on a short timer (not rAF — rAF is paused in
    // background/hidden tabs, which would leave Jakov stuck off-screen).
    if (slideTimer.current) clearTimeout(slideTimer.current);
    slideTimer.current = setTimeout(() => setSlid(true), 40);
    playSiren();
  }, [playSiren]);

  const dismiss = useCallback(() => {
    sirenStop.current?.();
    setPhase("leaving");
    // Matches the longer "drive all the way across and off the right edge" exit.
    window.setTimeout(() => setPhase("idle"), 1250);
  }, []);

  // Manual trigger (the badge by the logo) + any future programmatic trigger.
  useEffect(() => {
    const handler = () => show();
    window.addEventListener("shiftclock:police-hour", handler);
    return () => window.removeEventListener("shiftclock:police-hour", handler);
  }, [show]);

  // Watch the logged-in agent's own break and summon Jakov near the end.
  useEffect(() => {
    if (!agentSession) return;
    const tick = () => {
      const me = agents.find(a => a.id === agentSession.agentId);
      const activeAt = me?.breakActiveAt;
      if (!activeAt) return;
      const elapsed = Date.now() - Date.parse(activeAt);
      const remaining = BREAK_DURATION_MS - elapsed;
      if (remaining <= WARN_LEAD_MS && remaining > -5000 && firedFor.current !== activeAt) {
        firedFor.current = activeAt;
        show();
      }
    };
    const t = window.setInterval(tick, 1000);
    tick();
    return () => window.clearInterval(t);
  }, [agents, agentSession, show]);

  // If they were away, give a fresh little woop when they come back to the tab.
  useEffect(() => {
    if (phase !== "shown") return;
    const onVis = () => { if (document.visibilityState === "visible") playSiren(); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [phase, playSiren]);

  useEffect(() => () => {
    const c = audioRef.current;
    audioRef.current = null;
    if (c && c.state !== "closed") void c.close();
  }, []);

  if (phase === "idle") return null;

  // On exit, drive fully across and off the right edge (a full viewport width,
  // plus his own width so no sliver is left behind) — not just his own width.
  const translateX = phase === "leaving" ? "calc(100vw + 100%)" : slid ? "0%" : "-135%";
  const transition = phase === "leaving"
    ? "transform 1.15s cubic-bezier(.45,.05,.55,.95)"   // steady cruise across the screen
    : "transform .75s cubic-bezier(.2,.8,.25,1)";       // snappy arrival

  return (
    // Container is click-through — only Jakov himself is interactive, so the rest
    // of the app stays usable while he's parked there.
    <div className="fixed inset-0 z-[100] pointer-events-none overflow-hidden">
      {/* Flashing red/blue glow behind the car */}
      <div
        className="absolute bottom-0 left-0 w-[60vw] max-w-[640px] h-[55vh] pointer-events-none"
        style={{ opacity: phase === "leaving" ? 0 : 1, transition: "opacity .4s ease" }}
      >
        <div className="police-flash-red  absolute bottom-24 left-8  w-40 h-40 rounded-full blur-3xl" />
        <div className="police-flash-blue absolute bottom-28 left-32 w-40 h-40 rounded-full blur-3xl" />
      </div>

      {/* Officer Jakov */}
      <button
        type="button"
        onClick={dismiss}
        aria-label="Send Officer Jakov off — your break's up"
        title="Break's up — click to send Officer Jakov off 🚓"
        className="absolute bottom-0 left-0 pointer-events-auto cursor-pointer bg-transparent border-0 p-0 focus:outline-none group"
        style={{
          transform: `translateX(${translateX})`,
          transition,
        }}
      >
        <img
          src="/jakovpolice.png"
          alt="Officer Jakov, Police Hour"
          draggable={false}
          className="h-[clamp(260px,52vh,560px)] w-auto select-none drop-shadow-[0_8px_30px_rgba(0,0,0,0.6)] group-hover:brightness-110 transition-[filter]"
          style={{ imageRendering: "pixelated" }}
        />
        {/* Speech / instruction bubble */}
        <div className="absolute top-2 left-[58%] -translate-x-1/2 whitespace-nowrap">
          <div className="police-bob rounded-lg bg-black/80 border border-amber-400/50 px-3 py-1.5 text-[11px] sm:text-xs font-semibold text-amber-200 shadow-lg">
            🚨 Police Hour — break's almost up!
            <div className="text-[10px] font-normal text-amber-200/70 mt-0.5">click me to send me off →</div>
          </div>
        </div>
      </button>
    </div>
  );
}
