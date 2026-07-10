import { io, Socket } from "socket.io-client";
import { ClientToServerEvents, ServerToClientEvents } from "./socket-events";

const SOCKET_URL =
  process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:5000";

export type ChatSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: ChatSocket | null = null;

/** Connect (or reconnect) the singleton socket with a JWT. */
export function connectSocket(token: string): ChatSocket {
  if (socket) {
    socket.disconnect();
  }
  socket = io(SOCKET_URL, {
    auth: { token },
    withCredentials: true,
    // Automatic reconnection if the backend drops: retry forever with
    // exponential backoff (1s → 5s max, ±50% jitter).
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    randomizationFactor: 0.5,
  });
  return socket;
}

export function getSocket(): ChatSocket | null {
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
