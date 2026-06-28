import { createContext, useContext } from "react";

export const AdminContext = createContext<boolean>(false);

export function useAdminMode(): boolean {
  return useContext(AdminContext);
}

// Admin status is owned by <App> (it tracks accessMode) and passed in, so the
// whole tree reacts immediately to sign-in / sign-out instead of reading the
// token once on mount.
export function AdminProvider({ value, children }: { value: boolean; children: React.ReactNode }) {
  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>;
}
