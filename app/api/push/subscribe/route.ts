import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/server";

export const runtime = "nodejs";

/** Stores a Web Push subscription for the signed-in user (verified from their Supabase access token). */
export async function POST(req: Request) {
  const sb = serviceClient();
  if (!sb) return NextResponse.json({ error: "supabase_not_configured" }, { status: 503 });
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data: u } = await sb.auth.getUser(token);
  if (!u.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sub = await req.json().catch(() => null);
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) return NextResponse.json({ error: "bad_subscription" }, { status: 400 });

  const { error } = await sb.from("push_subscriptions").upsert({ user_id: u.user.id, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth }, { onConflict: "endpoint" });
  if (error) return NextResponse.json({ error: "db" }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const sb = serviceClient();
  if (!sb) return NextResponse.json({ error: "supabase_not_configured" }, { status: 503 });
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: u } = await sb.auth.getUser(token);
  if (!u.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { endpoint } = await req.json().catch(() => ({}));
  if (endpoint) await sb.from("push_subscriptions").delete().eq("endpoint", endpoint).eq("user_id", u.user.id);
  return NextResponse.json({ ok: true });
}
