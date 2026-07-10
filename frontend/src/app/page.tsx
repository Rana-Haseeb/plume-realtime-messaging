"use client";

import { useEffect, useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { api, saveSession, getToken } from "@/lib/api";
import { useSocket } from "@/context/SocketContext";
import { User } from "@/lib/types";
import Logo from "@/components/Logo";

type Mode = "login" | "signup" | "forgot";

export default function AuthPage() {
  const router = useRouter();
  const { connect } = useSocket();
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (getToken()) router.replace("/chat");
  }, [router]);

  function switchMode(m: Mode) {
    setMode(m);
    setError(null);
    setNotice(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "forgot") {
        await api("/api/auth/forgot-password", {
          method: "POST",
          body: JSON.stringify({ email }),
        });
        setNotice(
          "If an account exists for that email, a reset link is on its way. Check your inbox."
        );
        setBusy(false);
        return;
      }
      const path = mode === "login" ? "/api/auth/login" : "/api/auth/signup";
      const payload =
        mode === "login" ? { email, password } : { username, email, password };
      const data = await api<{ token: string; user: User }>(path, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      saveSession(data.token, data.user);
      connect(data.token);
      router.push("/chat");
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const inputClass =
    "w-full rounded-xl border border-[var(--border)] bg-white px-4 py-3 text-[15px] text-[var(--text)] placeholder:text-[var(--text-secondary)] outline-none transition-colors focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20";

  const heading =
    mode === "login"
      ? "Welcome back to Plume"
      : mode === "signup"
        ? "Join Plume"
        : "Reset your password";
  const subheading =
    mode === "login"
      ? "Please enter your email and password."
      : mode === "signup"
        ? "Choose a username and enter your details to get started."
        : "Enter your email and we'll send you a reset link.";
  const submitLabel =
    mode === "login" ? "Sign in" : mode === "signup" ? "Create account" : "Send reset link";

  return (
    <div className="flex min-h-screen items-center justify-center bg-white px-4">
      <main className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center">
          <div className="mb-5 rounded-[1.75rem] shadow-lg shadow-indigo-200">
            <Logo size={80} />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">
            {heading}
          </h1>
          <p className="mt-2 text-center text-[15px] text-[var(--text-secondary)]">
            {subheading}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5">
          {mode === "signup" && (
            <input
              className={inputClass}
              placeholder="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              minLength={3}
              required
            />
          )}
          <input
            type={mode === "login" ? "text" : "email"}
            className={inputClass}
            placeholder={mode === "login" ? "Email or username" : "Email"}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          {mode !== "forgot" && (
            <input
              type="password"
              className={inputClass}
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={6}
              required
            />
          )}

          {mode === "login" && (
            <div className="text-right">
              <button
                type="button"
                className="text-sm font-medium text-[var(--accent)] hover:underline"
                onClick={() => switchMode("forgot")}
              >
                Forgot password?
              </button>
            </div>
          )}

          {error && (
            <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-[var(--danger)]">
              {error}
            </p>
          )}
          {notice && (
            <p className="rounded-lg bg-[var(--accent-soft)] px-4 py-2.5 text-sm text-[var(--accent)]">
              {notice}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl bg-[var(--accent)] py-3 text-[15px] font-semibold text-white transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-60"
          >
            {busy ? "Please wait…" : submitLabel}
          </button>
        </form>

        <p className="mt-6 text-center text-[15px] text-[var(--text-secondary)]">
          {mode === "login" ? (
            <>
              Don&apos;t have an account?{" "}
              <button className="font-medium text-[var(--accent)] hover:underline" onClick={() => switchMode("signup")}>
                Sign up
              </button>
            </>
          ) : mode === "signup" ? (
            <>
              Already have an account?{" "}
              <button className="font-medium text-[var(--accent)] hover:underline" onClick={() => switchMode("login")}>
                Sign in
              </button>
            </>
          ) : (
            <button className="font-medium text-[var(--accent)] hover:underline" onClick={() => switchMode("login")}>
              ← Back to sign in
            </button>
          )}
        </p>
      </main>
    </div>
  );
}
