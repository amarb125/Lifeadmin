import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Fallback speech-to-text for browsers without the Web Speech API (e.g. Firefox). Needs OPENAI_API_KEY. */
export async function POST(req: Request) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return NextResponse.json({ error: "not_configured" }, { status: 501 });

  const form = await req.formData();
  const audio = form.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) return NextResponse.json({ error: "no_audio" }, { status: 400 });
  if (audio.size > 10 * 1024 * 1024) return NextResponse.json({ error: "too_large" }, { status: 413 });

  const out = new FormData();
  out.append("file", audio, (audio as File).name || "voice.webm");
  out.append("model", process.env.TRANSCRIBE_MODEL || "whisper-1");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: out,
  });
  if (!res.ok) return NextResponse.json({ error: "upstream" }, { status: 502 });
  const json = await res.json();
  return NextResponse.json({ text: json.text || "" });
}
