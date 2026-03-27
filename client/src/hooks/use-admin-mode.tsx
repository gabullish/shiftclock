import { createContext, useContext, useMemo } from "react";
import { getEffectiveAdminToken } from "@/lib/adminAccess";

function readAdminFromUrl(): boolean {
  return Boolean(getEffectiveAdminToken());
}

export const AdminContext = createContext<boolean>(false);

export function useAdminMode(): boolean {
  return useContext(AdminContext);
}

// Provider reads once on mount (token doesn't change during session)
export function AdminProvider({ children }: { children: React.ReactNode }) {
  const isAdmin = useMemo(() => readAdminFromUrl(), []);
  return <AdminContext.Provider value={isAdmin}>{children}</AdminContext.Provider>;
}
