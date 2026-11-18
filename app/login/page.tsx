"use client";

import { useState } from "react";

export default function Login() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      window.location.href = "/";
      return;
    }
    setError(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Couldn't sign in");
    setBusy(false);
  };

  return (
    <main className="login">
      <form onSubmit={submit} className="login-form">
        <span className="wordmark">Operations</span>
        <input
          type="password"
          className="login-input"
          placeholder="Password"
          autoFocus
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="login-error">{error}</p>}
        <button className="mono-btn" data-primary="" disabled={!password || busy}>
          Sign in
        </button>
      </form>
    </main>
  );
}
