"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, getStoredUser, getToken, saveSession } from "@/lib/api";
import { User } from "@/lib/types";
import Logo from "@/components/Logo";

type Status = "verifying" | "success" | "error";

export default function VerifyEmailPage() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("verifying");
  const [message, setMessage] = useState("Verifying your email…");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) {
      setStatus("error");
      setMessage("This verification link is missing its token.");
      return;
    }
    api<{ ok: boolean; user?: User }>("/api/auth/verify-email", {
      method: "POST",
      body: JSON.stringify({ token }),
    })
      .then((data) => {
        setStatus("success");
        setMessage("Your email is verified. Thanks for confirming!");
        // Keep the local session in sync if this is the signed-in user
        const t = getToken();
        const stored = getStoredUser();
        if (t && data.user && stored && (stored.id ?? stored._id) === data.user.id) {
          saveSession(t, data.user);
        }
      })
      .catch((err) => {
        setStatus("error");
        setMessage((err as Error).message);
      });
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] px-4">
      <main className="w-full max-w-sm text-center">
        <div className="mb-6 flex flex-col items-center">
          <div className="mb-5 rounded-[1.75rem] shadow-lg shadow-indigo-200">
            <Logo size={80} />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">
            {status === "success"
              ? "Email verified"
              : status === "error"
                ? "Verification failed"
                : "Verifying…"}
          </h1>
        </div>
        <p
          className={`mb-6 text-[15px] ${
            status === "error" ? "text-[var(--danger)]" : "text-[var(--text-secondary)]"
          }`}
        >
          {message}
        </p>
        <button
          onClick={() => router.push(getToken() ? "/chat" : "/")}
          className="w-full rounded-xl bg-[var(--accent)] py-3 text-[15px] font-semibold text-white hover:bg-[var(--accent-hover)]"
        >
          {getToken() ? "Back to Plume" : "Go to sign in"}
        </button>
      </main>
    </div>
  );
}
