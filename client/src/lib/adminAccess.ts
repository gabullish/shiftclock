const ADMIN_TOKEN_STORAGE_KEY = "shiftclock-admin-token";

export function getStoredAdminToken(): string {
  return sessionStorage.getItem(ADMIN_TOKEN_STORAGE_KEY) || "";
}

export function getEffectiveAdminToken(): string {
  return getStoredAdminToken();
}

export function saveAdminToken(token: string): void {
  sessionStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, token);
}

export function clearAdminToken(): void {
  sessionStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
}
