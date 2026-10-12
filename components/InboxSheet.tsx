"use client";

import { Bell, BellRing, HelpCircle } from "lucide-react";
import { useApp } from "@/lib/app-context";
import { formatWhen } from "@/lib/time";
import { Sheet } from "./ui";

const CHANNEL = {
  "in-app": "Shown in the app",
  browser: "Shown in app + sent to your browser's notifications",
  push: "Push accepted by your device's push service",
} as const;

export function InboxSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { notifications, markAllRead } = useApp();
  return (
    <Sheet open={open} onClose={onClose} title="Inbox">
      {notifications.length === 0 ? (
        <p className="py-8 text-center text-muted">Nothing yet. Reminders and check-ins will collect here.</p>
      ) : (
        <>
          <button className="btn-ghost mb-3" onClick={markAllRead}>Mark all read</button>
          <ul className="space-y-2">
            {notifications.map((n) => (
              <li key={n.id} className="card flex gap-3 p-3">
                <span className="mt-0.5 text-accent">{n.kind === "followup" ? <HelpCircle size={18} /> : n.readAt ? <Bell size={18} /> : <BellRing size={18} />}</span>
                <div className="min-w-0">
                  <p className={n.readAt ? "text-muted" : "font-medium"}>{n.title}</p>
                  <p className="text-sm text-muted">{n.body}</p>
                  <p className="mt-1 text-xs text-muted">{formatWhen(n.createdAt)} · {CHANNEL[n.channel]}</p>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </Sheet>
  );
}
