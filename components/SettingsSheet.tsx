"use client";

import { useState } from "react";
import { useApp } from "@/lib/app-context";
import { offsetLabel } from "@/lib/time";
import { Sheet, Toggle } from "./ui";

const PRESETS = [4320, 1440, 180, 60, 15, 5];

export function SettingsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { settings, saveSettings, enablePush, pushPermission, pushServerReady, mode, userEmail, signOut } = useApp();
  const [pushMsg, setPushMsg] = useState<string | null>(null);
  const set = (p: Partial<typeof settings>) => saveSettings({ ...settings, ...p });
  const toggleOffset = (o: number) =>
    set({ defaultOffsets: settings.defaultOffsets.includes(o) ? settings.defaultOffsets.filter((x) => x !== o) : [...settings.defaultOffsets, o].sort((a, b) => b - a) });

  return (
    <Sheet open={open} onClose={onClose} title="Settings">
      <div className="space-y-6">
        <section className="card p-4">
          <h3 className="font-medium">Notifications</h3>
          <p className="mt-1 text-sm text-muted">
            {pushPermission === "granted" ? "Browser notifications are allowed." : pushPermission === "denied" ? "Notifications are blocked in your browser settings." : pushPermission === "unsupported" ? "This browser doesn't support notifications." : "Not enabled yet."}{" "}
            {pushServerReady ? "Push reminders can reach this device even when LifePilot is closed." : mode === "demo" ? "Demo mode: reminders only appear while LifePilot is open in a tab. Connect Supabase and push keys for background reminders." : "Server push isn't configured, so reminders appear in-app while LifePilot is open."}
          </p>
          <button className="btn-ghost mt-3" onClick={async () => setPushMsg(await enablePush())} disabled={pushPermission === "unsupported"}>Enable notifications</button>
          {pushMsg && <p className="mt-2 text-sm" role="status">{pushMsg}</p>}
        </section>

        <section>
          <h3 className="font-medium">Default reminders</h3>
          <p className="mb-2 text-sm text-muted">Applied to new tasks, then adapted to the time actually left. You can still edit each task.</p>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((o) => {
              const on = settings.defaultOffsets.includes(o);
              return <button key={o} aria-pressed={on} onClick={() => toggleOffset(o)} className={`chip ${on ? "border-accent bg-accent/10 text-accent" : ""}`}>{offsetLabel(o)}</button>;
            })}
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div><h3 className="font-medium">Quiet hours</h3><p className="text-sm text-muted">Reminders are moved out of this window.</p></div>
            <Toggle label="Quiet hours" checked={settings.quietEnabled} onChange={(v) => set({ quietEnabled: v })} />
          </div>
          {settings.quietEnabled && (
            <div className="flex items-center gap-2">
              <input aria-label="Quiet hours start" type="time" className="field" value={settings.quietStart} onChange={(e) => e.target.value && set({ quietStart: e.target.value })} />
              <span className="text-muted">to</span>
              <input aria-label="Quiet hours end" type="time" className="field" value={settings.quietEnd} onChange={(e) => e.target.value && set({ quietEnd: e.target.value })} />
            </div>
          )}
          <p className="text-xs text-muted">Time zone: {settings.timezone}</p>
        </section>

        <section>
          <label className="label" htmlFor="fu">If I miss a deadline, ask again every</label>
          <select id="fu" className="field" value={settings.followUpIntervalMin} onChange={(e) => set({ followUpIntervalMin: parseInt(e.target.value, 10) })}>
            {[15, 30, 60, 120, 240, 1440].map((m) => <option key={m} value={m}>{m >= 1440 ? "day" : m >= 60 ? `${m / 60} hour${m > 60 ? "s" : ""}` : `${m} minutes`}</option>)}
          </select>
        </section>

        <section className="flex items-center justify-between gap-4">
          <div><h3 className="font-medium">Save without reviewing</h3><p className="text-sm text-muted">Skip the confirmation screen when nothing is unclear. I'll still ask if a deadline is missing.</p></div>
          <Toggle label="Save immediately" checked={settings.autoSave} onChange={(v) => set({ autoSave: v })} />
        </section>

        <section className="card p-4 text-sm text-muted">
          <p><strong className="text-ink">{mode === "demo" ? "Demo mode" : "Connected"}</strong> — {mode === "demo" ? "your tasks are stored only in this browser." : `signed in as ${userEmail ?? "you"}; tasks are stored in your account.`}</p>
          {mode === "supabase" && <button className="btn-ghost mt-3" onClick={() => { onClose(); signOut(); }}>Sign out</button>}
        </section>
      </div>
    </Sheet>
  );
}
