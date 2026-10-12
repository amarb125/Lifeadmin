"use client";

import { publicEnv } from "../env";
import { api } from "./api";

export type PushState =
  | { kind: "unsupported"; reason: string }
  | { kind: "denied" }
  | { kind: "off" }
  | { kind: "on" };

function urlBase64ToArrayBuffer(base64: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const buf = new ArrayBuffer(raw.length);
  const out = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return buf;
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}
function isStandalone(): boolean {
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

export async function getPushState(): Promise<PushState> {
  if (typeof window === "undefined") return { kind: "unsupported", reason: "Not in a browser." };
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    if (isIos() && !isStandalone()) {
      return { kind: "unsupported", reason: "On iPhone and iPad, push works only after you add LifePilot to your Home Screen (Share → Add to Home Screen) and open it from there." };
    }
    return { kind: "unsupported", reason: "This browser doesn't support push notifications." };
  }
  if (Notification.permission === "denied") return { kind: "denied" };
  const reg = await navigator.serviceWorker.getRegistration("/sw.js");
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === "granted" ? { kind: "on" } : { kind: "off" };
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch {
    return null;
  }
}

/** Ask permission, subscribe, and register the endpoint with the server. Throws a user-readable Error on failure. */
export async function enablePush(): Promise<void> {
  if (!publicEnv.vapidPublicKey) throw new Error("Push isn't configured on this server yet.");
  const state = await getPushState();
  if (state.kind === "unsupported") throw new Error(state.reason);
  if (state.kind === "denied") throw new Error("Notifications are blocked for this site. Allow them in your browser's site settings, then try again.");

  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notification permission wasn't granted.");

  const reg = (await registerServiceWorker()) ?? (await navigator.serviceWorker.ready);
  await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  const sub =
    existing ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToArrayBuffer(publicEnv.vapidPublicKey),
    }));
  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) throw new Error("The browser returned an incomplete push subscription.");
  await api("/api/push/subscribe", { method: "POST", body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }) });
}

export async function disablePush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration("/sw.js");
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  await api("/api/push/subscribe", { method: "DELETE", body: JSON.stringify({ endpoint }) }).catch(() => undefined);
}
