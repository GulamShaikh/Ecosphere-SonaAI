"use client";
import { useState } from "react";
import Link from "next/link";

export default function ContactPage() {
  const [sent, setSent] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSent(true);
    setTimeout(() => setSent(false), 3000);
  };

  return (
    <div
      className="flex h-[100dvh] overflow-hidden flex-col items-center justify-center px-4 bg-center bg-cover bg-no-repeat bg-fixed"
      style={{ backgroundImage: 'url("/Auth-Bg.png")' }}
    >
      <Link
        href="/"
        className="absolute top-6 left-6 flex items-center gap-2 text-sm font-medium transition-opacity hover:opacity-70"
        style={{ color: "#707070" }}
      >
        ← Back to Home
      </Link>

      <div
        className="relative w-full max-w-lg overflow-hidden rounded-3xl p-8 sm:p-12 text-center"
        style={{
          background: "#FFFFFF",
          border: "1px solid rgba(0,0,0,0.06)",
          boxShadow: "0 20px 40px -20px rgba(0,0,0,0.05)",
        }}
      >
        <h1
          className="text-3xl font-bold mb-4"
          style={{ color: "#000000", fontFamily: "var(--font-manrope)" }}
        >
          Contact Us
        </h1>
        <p className="text-sm mb-6" style={{ color: "#707070" }}>
          Have any questions? We&apos;d love to hear from you.
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 text-left">
          <div>
            <label
              className="mb-1 block text-xs font-semibold"
              style={{ color: "#707070" }}
            >
              Name
            </label>
            <input
              type="text"
              required
              className="w-full rounded-xl px-4 py-3 text-sm outline-none transition-colors"
              style={{
                background: "#F5F5F5",
                border: "1px solid rgba(0, 0, 0, 0.06)",
                color: "#000000",
              }}
            />
          </div>
          <div>
            <label
              className="mb-1 block text-xs font-semibold"
              style={{ color: "#707070" }}
            >
              Email
            </label>
            <input
              type="email"
              required
              className="w-full rounded-xl px-4 py-3 text-sm outline-none transition-colors"
              style={{
                background: "#F5F5F5",
                border: "1px solid rgba(0, 0, 0, 0.06)",
                color: "#000000",
              }}
            />
          </div>
          <div>
            <label
              className="mb-1 block text-xs font-semibold"
              style={{ color: "#707070" }}
            >
              Message
            </label>
            <textarea
              required
              rows={4}
              className="w-full rounded-xl px-4 py-3 text-sm outline-none transition-colors resize-none"
              style={{
                background: "#F5F5F5",
                border: "1px solid rgba(0, 0, 0, 0.06)",
                color: "#000000",
              }}
            />
          </div>
          <button
            type="submit"
            className="mt-2 w-full rounded-xl py-3 text-sm font-bold transition-all duration-200"
            style={{
              background: sent ? "#4ade80" : "var(--es-action-primary)",
              color: sent ? "#000000" : "var(--es-on-primary)",
            }}
          >
            {sent ? "Message Sent!" : "Send Message"}
          </button>
        </form>
      </div>
    </div>
  );
}
