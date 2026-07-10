"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  ReactNode,
} from "react";
import {
  connectSocket,
  disconnectSocket,
  getSocket,
  ChatSocket,
} from "@/lib/socket";
import { clearSession, getToken } from "@/lib/api";

interface SocketContextValue {
  /** The live socket instance, or null when logged out. */
  socket: ChatSocket | null;
  /** True while the socket is connected to the server. */
  connected: boolean;
  /** Connect with a JWT (called after login/signup). */
  connect: (token: string) => ChatSocket;
  /** Tear the connection down (called on logout). */
  disconnect: () => void;
}

const SocketContext = createContext<SocketContextValue>({
  socket: null,
  connected: false,
  connect: () => {
    throw new Error("SocketProvider is not mounted");
  },
  disconnect: () => {},
});

export function SocketProvider({ children }: { children: ReactNode }) {
  const [socket, setSocket] = useState<ChatSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const startedRef = useRef(false);

  const connect = useCallback((token: string): ChatSocket => {
    const s = connectSocket(token);
    s.on("connect", () => setConnected(true));
    s.on("disconnect", () => setConnected(false));
    s.on("connect_error", (err) => {
      // An invalid/expired JWT means the session is dead
      if (/token|auth/i.test(err.message)) {
        clearSession();
        disconnectSocket();
        setSocket(null);
        setConnected(false);
      }
    });
    setSocket(s);
    return s;
  }, []);

  const disconnect = useCallback(() => {
    disconnectSocket();
    setSocket(null);
    setConnected(false);
  }, []);

  // Reconnect automatically on page load if a session exists,
  // so the connection persists across routes and refreshes.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const token = getToken();
    if (token && !getSocket()) {
      connect(token);
    }
  }, [connect]);

  return (
    <SocketContext.Provider value={{ socket, connected, connect, disconnect }}>
      {children}
    </SocketContext.Provider>
  );
}

/** Access the app-wide persistent Socket.io connection. */
export function useSocket(): SocketContextValue {
  return useContext(SocketContext);
}
