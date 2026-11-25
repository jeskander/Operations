"use client";

import { useEffect, useRef, useState } from "react";

/** Cut a piece once it's at least this long and you pause. */
const MIN_PIECE_MS = 20_000;
/** Cut a piece at this length even without a pause. */
const MAX_PIECE_MS = 60_000;
/** How long a pause has to be to cut there. */
const PAUSE_MS = 450;
/** Loudness (RMS) below which it's a pause, and above which it's speech. */
const QUIET = 0.012;
const SPEECH = 0.02;

function pickType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const t of ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg;codecs=opus"]) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return "";
}

type Session = {
  stream: MediaStream;
  ctx: AudioContext;
  timer: ReturnType<typeof setInterval>;
  rec: MediaRecorder | null;
  pieceStart: number;
  quietSince: number | null;
  heardSpeech: boolean;
  stopping: boolean;
};

/**
 * Dictation that transcribes as you go. The recording is cut into pieces at natural pauses
 * (about every 20–60 seconds); each piece is sent to the AI speech model while you carry on
 * talking, and its text is added in order. There's no length limit. Audio is never kept.
 */
export function useRecorder(onText: (text: string) => void, currentId: string | null) {
  const [supported, setSupported] = useState(false);
  const [state, setState] = useState<"idle" | "recording" | "finishing">("idle");
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const session = useRef<Session | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const said = useRef("");
  const onTextRef = useRef(onText);
  onTextRef.current = onText;
  const idRef = useRef(currentId);
  idRef.current = currentId;

  useEffect(() => {
    setSupported(typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined");
    return () => {
      const s = session.current;
      if (!s) return;
      s.stopping = true;
      if (s.rec?.state === "recording") s.rec.stop();
      clearInterval(s.timer);
      s.stream.getTracks().forEach((t) => t.stop());
      s.ctx.close().catch(() => {});
    };
  }, []);

  /** Transcribe one piece, in order after the ones before it. */
  const send = (blob: Blob) => {
    setPending((n) => n + 1);
    queue.current = queue.current.then(async () => {
      try {
        const ext = blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm";
        const form = new FormData();
        form.append("audio", blob, `dictation.${ext}`);
        if (idRef.current) form.append("currentId", idRef.current);
        if (said.current) form.append("previous", said.current.slice(-600));
        const res = await fetch("/api/transcribe", { method: "POST", body: form, cache: "no-store" });
        const body = (await res.json().catch(() => null)) as { text?: string; error?: string } | null;
        if (!res.ok) throw new Error(body?.error ?? "Couldn't transcribe that");
        const text = body?.text?.trim();
        if (text) {
          said.current = `${said.current} ${text}`.trim();
          onTextRef.current(text);
        }
      } catch (e) {
        setError(`${(e as Error).message}. Some of what you said may be missing.`);
      } finally {
        setPending((n) => n - 1);
      }
    });
  };

  /** Start recording a new piece on the open microphone. */
  const startPiece = (s: Session) => {
    const mimeType = pickType();
    const rec = new MediaRecorder(s.stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 32_000 });
    const chunks: Blob[] = [];
    const heard = { speech: false };
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      // Skip pieces with no speech: speech models invent words for silence.
      if (heard.speech && chunks.length) send(new Blob(chunks, { type: rec.mimeType || mimeType || "audio/webm" }));
    };
    rec.start(1000);
    s.rec = rec;
    s.pieceStart = Date.now();
    s.quietSince = null;
    s.heardSpeech = false;
    return heard;
  };

  const start = async () => {
    if (session.current) return;
    setError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      setError("Microphone blocked. Allow it in the browser's settings.");
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    const startedAt = Date.now();
    said.current = "";

    const s: Session = { stream, ctx, timer: 0 as unknown as ReturnType<typeof setInterval>, rec: null, pieceStart: 0, quietSince: null, heardSpeech: false, stopping: false };
    let heard = startPiece(s);
    s.timer = setInterval(() => {
      if (s.stopping) return;
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      const rms = Math.sqrt(sum / buf.length);
      const now = Date.now();
      if (rms > SPEECH) heard.speech = true;
      s.quietSince = rms < QUIET ? (s.quietSince ?? now) : null;
      const age = now - s.pieceStart;
      const pause = s.quietSince !== null && now - s.quietSince > PAUSE_MS;
      if ((age > MIN_PIECE_MS && pause) || age > MAX_PIECE_MS) {
        s.rec?.stop();
        heard = startPiece(s);
      }
    }, 100);
    session.current = s;
    setElapsed(0);
    setState("recording");
  };

  const stop = async () => {
    const s = session.current;
    if (!s) return;
    s.stopping = true;
    clearInterval(s.timer);
    setState("finishing");
    await new Promise<void>((resolve) => {
      if (s.rec?.state !== "recording") return resolve();
      s.rec.addEventListener("stop", () => resolve(), { once: true });
      s.rec.stop();
    });
    s.stream.getTracks().forEach((t) => t.stop());
    s.ctx.close().catch(() => {});
    session.current = null;
    await queue.current;
    setState("idle");
  };

  return { supported, state, pending, error, elapsed, start, stop };
}
