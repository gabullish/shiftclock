import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface AgentFormData {
  name: string;
  color: string;
  timezone: string;
  role: string;
  avatarUrl: string;
}

const TIMEZONES = [
  "UTC",
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "America/Sao_Paulo", "America/Bogota", "America/Santo_Domingo",
  "America/Mexico_City", "America/Toronto",
  "Europe/London", "Europe/Paris", "Europe/Berlin", "Europe/Madrid",
  "Europe/Zagreb", "Europe/Moscow",
  "Africa/Johannesburg", "Africa/Casablanca", "Africa/Lagos",
  "Africa/Nairobi", "Africa/Addis_Ababa",
  "Asia/Dubai", "Asia/Kolkata", "Asia/Bangkok", "Asia/Singapore",
  "Asia/Manila", "Asia/Tokyo", "Asia/Seoul", "Asia/Shanghai",
  "Australia/Sydney", "Australia/Melbourne",
  "Pacific/Auckland", "Pacific/Honolulu",
];

export const DEFAULT_COLORS = [
  "#C4A574", "#D4A574", "#C69B7B", "#B8956A", "#A68A64",
  "#9B8B7E", "#B5A69D", "#C4B5A0", "#D4C4B0", "#E5D5C4",
  "#C8A88C", "#B39B8D", "#A89080",
];

export function AgentForm({
  defaultValues,
  defaultColor = "#C4A574",
  onSubmit,
  loading,
  playSuccess,
  playSoftClick,
}: {
  defaultValues?: AgentFormData;
  defaultColor?: string;
  onSubmit: (data: AgentFormData) => void;
  loading: boolean;
  playSuccess: () => void;
  playSoftClick: () => void;
}) {
  const [form, setForm] = useState<AgentFormData>({
    name: defaultValues?.name || "",
    color: defaultValues?.color || defaultColor,
    timezone: defaultValues?.timezone || "UTC",
    role: defaultValues?.role || "Support Agent",
    avatarUrl: defaultValues?.avatarUrl || "",
  });

  const set = (k: keyof AgentFormData, v: string) => setForm(f => ({ ...f, [k]: v }));

  return (
    <form onSubmit={(e) => { e.preventDefault(); playSuccess(); onSubmit(form); }} className="space-y-4">
      <div className="space-y-1.5">
        <Label className="text-xs">Name</Label>
        <Input
          value={form.name}
          onChange={e => set("name", e.target.value)}
          placeholder="Agent name"
          required
          data-testid="input-agent-name"
          className="bg-muted border-border text-sm"
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Role</Label>
        <Input
          value={form.role}
          onChange={e => set("role", e.target.value)}
          placeholder="Support Agent"
          className="bg-muted border-border text-sm"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Color</Label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={form.color}
              onChange={e => set("color", e.target.value)}
              className="w-9 h-9 rounded cursor-pointer bg-transparent border border-border"
              data-testid="input-agent-color"
            />
            <div className="flex flex-wrap gap-1">
              {DEFAULT_COLORS.slice(0, 8).map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => { playSoftClick(); set("color", c); }}
                  className="w-4 h-4 rounded-full border border-transparent hover:scale-110 transition-transform"
                  style={{ backgroundColor: c, borderColor: form.color === c ? "white" : "transparent" }}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Timezone</Label>
          <Select value={form.timezone} onValueChange={v => set("timezone", v)}>
            <SelectTrigger className="bg-muted border-border text-sm h-9" data-testid="select-timezone">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-48">
              {TIMEZONES.map(tz => (
                <SelectItem key={tz} value={tz} className="text-xs">{tz}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Avatar URL (optional)</Label>
        <Input
          value={form.avatarUrl}
          onChange={e => set("avatarUrl", e.target.value)}
          placeholder="https://..."
          className="bg-muted border-border text-sm"
        />
      </div>

      <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/40 border border-border">
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold"
          style={{ backgroundColor: form.color + "20", border: `2px solid ${form.color}50`, color: form.color }}
        >
          {form.name ? form.name.slice(0, 2).toUpperCase() : "??"}
        </div>
        <div>
          <p className="text-sm font-medium">{form.name || "Agent name"}</p>
          <p className="text-[10px] text-muted-foreground">{form.role} · {form.timezone}</p>
        </div>
      </div>

      <Button type="submit" disabled={loading} className="w-full" data-testid="btn-submit-agent">
        {loading ? "Saving…" : "Save Agent"}
      </Button>
    </form>
  );
}
