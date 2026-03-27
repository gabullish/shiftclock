import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

type DragScrollContextValue = {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
};

const defaultDragScrollContext: DragScrollContextValue = {
  enabled: true,
  setEnabled: () => {},
};

const DragScrollContext = createContext<DragScrollContextValue>(defaultDragScrollContext);

const STORAGE_KEY = "drag-scroll-enabled";

export function DragScrollProvider({ children }: { children: React.ReactNode }) {
  const [enabled, setEnabledState] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw == null ? true : raw === "1";
  });

  const setEnabled = (next: boolean) => {
    setEnabledState(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    }
  };

  const value = useMemo(() => ({ enabled, setEnabled }), [enabled]);

  return <DragScrollContext.Provider value={value}>{children}</DragScrollContext.Provider>;
}

export function useDragScrollPreference() {
  return useContext(DragScrollContext);
}

export function useDragScroll<T extends HTMLElement>(
  ref: React.RefObject<T>,
  enabled: boolean
) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;

    let dragging = false;
    let startX = 0;
    let startY = 0;
    let baseLeft = 0;
    let baseTop = 0;

    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, button, a, [data-no-drag-scroll='true']")) {
        return;
      }
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      baseLeft = el.scrollLeft;
      baseTop = el.scrollTop;
      el.style.cursor = "grabbing";
      el.style.userSelect = "none";
      e.preventDefault();
    };

    const onMove = (e: MouseEvent) => {
      if (!dragging) return;
      el.scrollLeft = baseLeft - (e.clientX - startX);
      el.scrollTop = baseTop - (e.clientY - startY);
    };

    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      el.style.cursor = "";
      el.style.userSelect = "";
    };

    el.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);

    return () => {
      el.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      el.style.cursor = "";
      el.style.userSelect = "";
    };
  }, [ref, enabled]);
}
