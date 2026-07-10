"use client";

import { useEffect, useRef } from "react";
import { useCall } from "@/hooks/useCall";
import Avatar from "./Avatar";

type Call = ReturnType<typeof useCall>;

function CtrlBtn({
  onClick,
  active = true,
  title,
  label,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  title: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <button
        onClick={onClick}
        title={title}
        className={`flex h-14 w-14 items-center justify-center rounded-full transition-colors ${
          active ? "bg-white/15 text-white hover:bg-white/25" : "bg-white text-gray-900 hover:bg-white/90"
        }`}
      >
        {children}
      </button>
      <span className="text-xs text-white/70">{label}</span>
    </div>
  );
}

export default function CallOverlay({ call }: { call: Call }) {
  const {
    status,
    peer,
    callType,
    micOn,
    camOn,
    localStream,
    remoteStream,
    accept,
    decline,
    hangup,
    toggleMic,
    toggleCam,
  } = call;

  const localRef = useRef<HTMLVideoElement>(null);
  const remoteRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (localRef.current) localRef.current.srcObject = localStream;
  }, [localStream, status]);
  useEffect(() => {
    if (remoteRef.current) remoteRef.current.srcObject = remoteStream;
  }, [remoteStream, status]);

  if (status === "idle" || !peer) return null;

  const isVideo = callType === "video";
  const showRemoteVideo = status === "connected" && isVideo;
  const showLocalThumb = isVideo && !!localStream;

  const EndButton = (
    <div className="flex flex-col items-center gap-1.5">
      <button
        onClick={hangup}
        title="End call"
        className="flex h-16 w-16 items-center justify-center rounded-full bg-red-600 text-white shadow-lg hover:bg-red-700"
      >
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M3 10c5-5 13-5 18 0l-2.5 2.5-3-1V9a13 13 0 0 0-7 0v2.5l-3 1L3 10Z" fill="currentColor" transform="rotate(135 12 12)" />
        </svg>
      </button>
      <span className="text-xs text-white/70">End</span>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-[#0b0d14] text-white">
      {status === "incoming" ? (
        /* ---------- Incoming: accept / decline ---------- */
        <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6">
          <Avatar name={peer.username} src={peer.avatar} size={120} />
          <div className="text-center">
            <p className="text-2xl font-semibold">{peer.username}</p>
            <p className="mt-1 text-white/70">
              Incoming {callType} call
              <span className="ml-1 inline-flex gap-0.5 align-middle">
                <span className="typing-dot" style={{ animationDelay: "0s" }} />
                <span className="typing-dot" style={{ animationDelay: "0.15s" }} />
                <span className="typing-dot" style={{ animationDelay: "0.3s" }} />
              </span>
            </p>
          </div>
          <div className="mt-8 flex items-center gap-16">
            <div className="flex flex-col items-center gap-2">
              <button onClick={decline} title="Decline" className="flex h-16 w-16 items-center justify-center rounded-full bg-red-600 text-white hover:bg-red-700">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                  <path d="M3 10c5-5 13-5 18 0l-2.5 2.5-3-1V9a13 13 0 0 0-7 0v2.5l-3 1L3 10Z" fill="currentColor" transform="rotate(135 12 12)" />
                </svg>
              </button>
              <span className="text-sm text-white/70">Decline</span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <button onClick={accept} title="Accept" className="flex h-16 w-16 items-center justify-center rounded-full bg-green-600 text-white hover:bg-green-700">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                  <path d="M3 10c5-5 13-5 18 0l-2.5 2.5-3-1V9a13 13 0 0 0-7 0v2.5l-3 1L3 10Z" fill="currentColor" />
                </svg>
              </button>
              <span className="text-sm text-white/70">Accept</span>
            </div>
          </div>
        </div>
      ) : (
        /* ---------- Outgoing / connected stage ---------- */
        <div className="relative flex-1 overflow-hidden">
          {/* Remote video — object-contain shows the full frame (no zoom/crop) */}
          <video
            ref={remoteRef}
            autoPlay
            playsInline
            className={`absolute inset-0 h-full w-full bg-black object-contain ${showRemoteVideo ? "" : "opacity-0"}`}
          />

          {/* Identity overlay for outgoing + audio calls (never blocks the buttons) */}
          {(status === "outgoing" || !isVideo) && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-4">
              <Avatar name={peer.username} src={peer.avatar} size={120} />
              <p className="text-2xl font-semibold">{peer.username}</p>
              <p className="text-white/70">
                {status === "outgoing" ? "Calling…" : "Connected"}
              </p>
            </div>
          )}

          {/* Top bar */}
          <div className="pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-black/60 to-transparent px-5 py-4">
            <p className="text-lg font-semibold">{peer.username}</p>
            <p className="text-sm text-white/70">
              {status === "outgoing" ? "Calling…" : `${callType} call`}
            </p>
          </div>

          {/* Local camera preview */}
          {showLocalThumb && (
            <video
              ref={localRef}
              autoPlay
              muted
              playsInline
              className="absolute right-4 top-20 aspect-[3/4] w-24 rounded-2xl border-2 border-white/25 object-cover shadow-lg sm:w-32"
            />
          )}

          {/* Controls — always visible, with a scrim so they read over any video */}
          <div className="absolute inset-x-0 bottom-0 flex items-end justify-center gap-6 bg-gradient-to-t from-black/70 to-transparent pb-10 pt-16">
            <CtrlBtn onClick={toggleMic} active={micOn} title={micOn ? "Mute" : "Unmute"} label={micOn ? "Mute" : "Unmute"}>
              {micOn ? (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <rect x="9" y="3" width="6" height="12" rx="3" fill="currentColor" />
                  <path d="M6 11a6 6 0 0 0 12 0M12 17v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              ) : (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <path d="M9 9v3a3 3 0 0 0 4.5 2.6M15 12V6a3 3 0 0 0-5.9-.7M6 11a6 6 0 0 0 9.3 5M12 17v3M4 4l16 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </CtrlBtn>

            {isVideo && (
              <CtrlBtn onClick={toggleCam} active={camOn} title={camOn ? "Turn camera off" : "Turn camera on"} label="Camera">
                {camOn ? (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <rect x="3" y="6" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="2" />
                    <path d="M15 10l6-3v10l-6-3" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                  </svg>
                ) : (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <path d="M3 6h9a2 2 0 0 1 2 2v2m0 4v0a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8M15 10l6-3v10M4 4l16 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </CtrlBtn>
            )}

            {EndButton}
          </div>
        </div>
      )}
    </div>
  );
}
