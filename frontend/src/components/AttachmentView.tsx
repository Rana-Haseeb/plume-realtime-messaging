"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Attachment } from "@/lib/types";

export function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function fmtTime(s: number): string {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

/** Voice-message player: play/pause + clickable pseudo-waveform + time. */
function AudioMessage({ attachment }: { attachment: Attachment }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(attachment.duration ?? 0);

  const bars = useMemo(
    () => Array.from({ length: 30 }, (_, i) => 25 + Math.abs(Math.sin(i * 1.7) * 70)),
    []
  );
  const progress = dur ? cur / dur : 0;

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => setCur(a.currentTime);
    const onMeta = () => {
      if (a.duration && isFinite(a.duration)) setDur(a.duration);
    };
    const onEnd = () => {
      setPlaying(false);
      setCur(0);
    };
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("loadedmetadata", onMeta);
    a.addEventListener("play", () => setPlaying(true));
    a.addEventListener("pause", () => setPlaying(false));
    a.addEventListener("ended", onEnd);
    return () => {
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("loadedmetadata", onMeta);
      a.removeEventListener("ended", onEnd);
    };
  }, []);

  function toggle() {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) a.play().catch(() => {});
    else a.pause();
  }
  function seek(e: React.MouseEvent<HTMLDivElement>) {
    const a = audioRef.current;
    if (!a || !dur) return;
    const rect = e.currentTarget.getBoundingClientRect();
    a.currentTime = ((e.clientX - rect.left) / rect.width) * dur;
  }

  return (
    <div className="flex min-w-[190px] items-center gap-2.5 py-0.5">
      <audio ref={audioRef} src={attachment.url} preload="metadata" />
      <button
        onClick={toggle}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-white"
        title={playing ? "Pause" : "Play"}
      >
        {playing ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
        )}
      </button>
      <div className="flex h-7 flex-1 items-center gap-[2px]" onClick={seek} role="slider" aria-label="Seek" tabIndex={0}>
        {bars.map((h, i) => (
          <span
            key={i}
            className="w-[3px] rounded-full"
            style={{
              height: `${h}%`,
              background: i / bars.length <= progress ? "var(--accent)" : "var(--text-secondary)",
              opacity: i / bars.length <= progress ? 1 : 0.4,
            }}
          />
        ))}
      </div>
      <span className="shrink-0 text-[11px] tabular-nums text-[var(--text-secondary)]">
        {fmtTime(playing || cur ? cur : dur)}
      </span>
    </div>
  );
}

export default function AttachmentView({ attachment }: { attachment: Attachment }) {
  if (attachment.type === "image") {
    return (
      <a href={attachment.url} target="_blank" rel="noreferrer" className="block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={attachment.url}
          alt={attachment.name}
          className="max-h-72 max-w-full rounded-xl object-cover"
        />
      </a>
    );
  }

  if (attachment.type === "audio") {
    return <AudioMessage attachment={attachment} />;
  }

  return (
    <a
      href={attachment.url}
      target="_blank"
      rel="noreferrer"
      download={attachment.name}
      className="flex items-center gap-3 rounded-xl bg-[var(--field)] p-2.5 transition-colors hover:bg-[var(--accent-soft)]"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)] text-white">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M14 3v5h5M14 3l5 5v11a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h8Z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <div className="min-w-0">
        <p className="truncate text-[14px] font-medium">{attachment.name}</p>
        <p className="text-[12px] text-[var(--text-secondary)]">
          {formatBytes(attachment.size)}
        </p>
      </div>
    </a>
  );
}
