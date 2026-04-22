"use client";

import { useState } from "react";
import type { ContactFormData, ContactFormResponse } from "@/types/contact";

type Status = "idle" | "sending" | "ok" | "error";

export function ContactForm() {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setStatus("sending");
    setError(null);
    const f = new FormData(e.currentTarget);
    const payload: ContactFormData = {
      name: String(f.get("name") ?? "").trim(),
      email: String(f.get("email") ?? "").trim(),
      message: String(f.get("message") ?? "").trim(),
      website: String(f.get("website") ?? ""),
    };
    if (!payload.name || !payload.email || !payload.message) {
      setStatus("error");
      setError("All fields are required.");
      return;
    }
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data: ContactFormResponse = await res.json();
      if (data.ok) {
        setStatus("ok");
        (e.target as HTMLFormElement).reset();
      } else {
        setStatus("error");
        setError(data.error || "Something went wrong.");
      }
    } catch {
      setStatus("error");
      setError("Network error. Try again.");
    }
  };

  return (
    <form onSubmit={onSubmit} className="contact-form">
      {/* Honeypot — hidden from humans */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        style={{ position: "absolute", left: "-9999px", width: 1, height: 1 }}
        aria-hidden
      />
      <label>
        <span>Name</span>
        <input name="name" type="text" required autoComplete="name" />
      </label>
      <label>
        <span>Email</span>
        <input name="email" type="email" required autoComplete="email" />
      </label>
      <label>
        <span>Message</span>
        <textarea name="message" rows={5} required />
      </label>
      <button type="submit" disabled={status === "sending"}>
        {status === "sending" ? "Sending…" : "Send"}
      </button>
      {status === "ok" && <p className="contact-msg ok">Sent. We&apos;ll be in touch.</p>}
      {status === "error" && <p className="contact-msg err">{error}</p>}
      <style jsx>{`
        .contact-form {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
        label {
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
          font-family: var(--font-mono), monospace;
          font-size: 0.7rem;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          color: var(--fg-dim);
        }
        input,
        textarea {
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: var(--fg);
          padding: 0.75rem 0.9rem;
          border-radius: 6px;
          font-family: var(--font-sans), system-ui, sans-serif;
          font-size: 0.95rem;
          letter-spacing: normal;
          text-transform: none;
          outline: none;
          transition: border-color 0.2s ease, background 0.2s ease;
        }
        input:focus,
        textarea:focus {
          border-color: var(--accent);
          background: rgba(78, 168, 255, 0.06);
        }
        button {
          align-self: flex-start;
          background: var(--fg);
          color: var(--bg);
          border: none;
          padding: 0.75rem 1.5rem;
          border-radius: 999px;
          font-weight: 600;
          font-size: 0.85rem;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          cursor: pointer;
          transition: transform 0.15s ease, background 0.15s ease;
        }
        button:hover:not(:disabled) {
          transform: translateY(-1px);
        }
        button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .contact-msg { font-size: 0.85rem; }
        .contact-msg.ok  { color: #7ad28c; }
        .contact-msg.err { color: #ff7a7a; }
      `}</style>
    </form>
  );
}
