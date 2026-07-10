"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChatSocket } from "@/lib/socket";
import { getIceServers } from "@/lib/webrtc";

export type CallStatus = "idle" | "outgoing" | "incoming" | "connected";
export type CallType = "audio" | "video";

export interface CallPeer {
  userId: string;
  username: string;
  avatar?: string;
}

export function useCall(socket: ChatSocket | null) {
  const [status, setStatus] = useState<CallStatus>("idle");
  const [peer, setPeer] = useState<CallPeer | null>(null);
  const [callType, setCallType] = useState<CallType>("video");
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const pendingCandidates = useRef<RTCIceCandidateInit[]>([]);
  const incomingOffer = useRef<RTCSessionDescriptionInit | null>(null);
  const peerRef = useRef<CallPeer | null>(null);
  const statusRef = useRef<CallStatus>("idle");
  const callTypeRef = useRef<CallType>("video");

  const setStatusBoth = (s: CallStatus) => {
    statusRef.current = s;
    setStatus(s);
  };

  /* ---------- Teardown: stop camera/mic, close the connection ---------- */
  const cleanup = useCallback(() => {
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    if (pcRef.current) {
      pcRef.current.onicecandidate = null;
      pcRef.current.ontrack = null;
      pcRef.current.onconnectionstatechange = null;
      pcRef.current.close();
      pcRef.current = null;
    }
    pendingCandidates.current = [];
    incomingOffer.current = null;
    peerRef.current = null;
    setStatusBoth("idle");
    setPeer(null);
    setLocalStream(null);
    setRemoteStream(null);
    setMicOn(true);
    setCamOn(true);
  }, []);

  const createPeer = useCallback(() => {
    const pc = new RTCPeerConnection({ iceServers: getIceServers() });
    pc.onicecandidate = (e) => {
      if (e.candidate && peerRef.current && socket) {
        socket.emit("ice-candidate", {
          toUserId: peerRef.current.userId,
          candidate: e.candidate.toJSON(),
        });
      }
    };
    pc.ontrack = (e) => {
      setRemoteStream(e.streams[0]);
      setStatusBoth("connected");
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed") cleanup();
    };
    pcRef.current = pc;
    return pc;
  }, [socket, cleanup]);

  const acquireMedia = useCallback(async (type: CallType) => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: type === "video",
    });
    localStreamRef.current = stream;
    setLocalStream(stream);
    return stream;
  }, []);

  const drainCandidates = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc) return;
    for (const c of pendingCandidates.current) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(c));
      } catch {
        /* ignore malformed candidate */
      }
    }
    pendingCandidates.current = [];
  }, []);

  /* ---------- Outgoing call ---------- */
  const startCall = useCallback(
    async (target: CallPeer, type: CallType) => {
      if (!socket || statusRef.current !== "idle") return;
      setError(null);
      peerRef.current = target;
      callTypeRef.current = type;
      try {
        const stream = await acquireMedia(type);
        const pc = createPeer();
        stream.getTracks().forEach((t) => pc.addTrack(t, stream));

        setPeer(target);
        setCallType(type);
        setMicOn(true);
        setCamOn(type === "video");
        setStatusBoth("outgoing");

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit("call-user", { toUserId: target.userId, sdp: offer, callType: type });
      } catch {
        setError("Couldn't access your camera/microphone. Check permissions.");
        cleanup();
      }
    },
    [socket, acquireMedia, createPeer, cleanup]
  );

  /* ---------- Accept an incoming call ---------- */
  const accept = useCallback(async () => {
    const offer = incomingOffer.current;
    const target = peerRef.current;
    if (!socket || !offer || !target) return;
    const type = callTypeRef.current;
    setError(null);
    try {
      const stream = await acquireMedia(type);
      const pc = createPeer();
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));

      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      await drainCandidates();

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("answer-call", { toUserId: target.userId, sdp: answer });

      setMicOn(true);
      setCamOn(type === "video");
      setStatusBoth("connected");
    } catch {
      setError("Couldn't access your camera/microphone. Check permissions.");
      if (target) socket.emit("end-call", { toUserId: target.userId, reason: "declined" });
      cleanup();
    }
  }, [socket, acquireMedia, createPeer, drainCandidates, cleanup]);

  const decline = useCallback(() => {
    const target = peerRef.current;
    if (socket && target) socket.emit("end-call", { toUserId: target.userId, reason: "declined" });
    cleanup();
  }, [socket, cleanup]);

  const hangup = useCallback(() => {
    const target = peerRef.current;
    if (socket && target) socket.emit("end-call", { toUserId: target.userId });
    cleanup();
  }, [socket, cleanup]);

  const toggleMic = useCallback(() => {
    const tracks = localStreamRef.current?.getAudioTracks() ?? [];
    tracks.forEach((t) => (t.enabled = !t.enabled));
    setMicOn((v) => !v);
  }, []);

  const toggleCam = useCallback(() => {
    const tracks = localStreamRef.current?.getVideoTracks() ?? [];
    tracks.forEach((t) => (t.enabled = !t.enabled));
    setCamOn((v) => !v);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  /* ---------- Signaling listeners ---------- */
  useEffect(() => {
    if (!socket) return;

    const onIncoming = (p: {
      from: { _id?: string; id?: string; username: string; avatar?: string };
      sdp: RTCSessionDescriptionInit;
      callType: CallType;
    }) => {
      // Busy → auto-decline the new caller
      if (statusRef.current !== "idle") {
        const fromId = p.from._id ?? p.from.id ?? "";
        socket.emit("end-call", { toUserId: fromId, reason: "busy" });
        return;
      }
      const fromId = p.from._id ?? p.from.id ?? "";
      incomingOffer.current = p.sdp;
      callTypeRef.current = p.callType;
      peerRef.current = { userId: fromId, username: p.from.username, avatar: p.from.avatar };
      setPeer({ userId: fromId, username: p.from.username, avatar: p.from.avatar });
      setCallType(p.callType);
      setStatusBoth("incoming");
    };

    const onAnswered = async (p: { sdp: RTCSessionDescriptionInit }) => {
      const pc = pcRef.current;
      if (!pc) return;
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(p.sdp));
        await drainCandidates();
      } catch {
        /* ignore */
      }
    };

    const onIce = (p: { candidate: RTCIceCandidateInit }) => {
      const pc = pcRef.current;
      if (pc && pc.remoteDescription) {
        pc.addIceCandidate(new RTCIceCandidate(p.candidate)).catch(() => {});
      } else {
        pendingCandidates.current.push(p.candidate);
      }
    };

    const onEnded = () => cleanup();
    const onError = (p: { message: string }) => {
      setError(p.message);
      cleanup();
    };

    socket.on("incoming-call", onIncoming);
    socket.on("call-answered", onAnswered);
    socket.on("ice-candidate", onIce);
    socket.on("call-ended", onEnded);
    socket.on("call-error", onError);
    return () => {
      socket.off("incoming-call", onIncoming);
      socket.off("call-answered", onAnswered);
      socket.off("ice-candidate", onIce);
      socket.off("call-ended", onEnded);
      socket.off("call-error", onError);
    };
  }, [socket, drainCandidates, cleanup]);

  return {
    status,
    peer,
    callType,
    micOn,
    camOn,
    localStream,
    remoteStream,
    error,
    startCall,
    accept,
    decline,
    hangup,
    toggleMic,
    toggleCam,
    clearError,
  };
}
