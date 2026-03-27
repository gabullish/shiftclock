import React, { createContext, useContext, useMemo, useState } from "react";

type DragScrollContextValue = {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
};

const DragScrollContext = createContext<DragScrollContextValue | null>(null);

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
  const ctx = useContext(DragScrollContext);
  if (!ctx) throw new Error("useDragScrollPreference must be used within DragScrollProvider");
  return ctx;
}

