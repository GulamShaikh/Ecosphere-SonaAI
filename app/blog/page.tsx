import Link from "next/link";

export default function BlogPage() {
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
        className="relative w-full max-w-2xl overflow-hidden rounded-3xl p-8 sm:p-12 text-center"
        style={{
          background: "#FFFFFF",
          border: "1px solid rgba(0,0,0,0.06)",
          boxShadow: "0 20px 40px -20px rgba(0,0,0,0.05)",
        }}
      >
        <h1
          className="text-4xl font-bold mb-6"
          style={{ color: "#000000", fontFamily: "var(--font-manrope)" }}
        >
          Blog & Updates
        </h1>
        <p className="text-lg leading-relaxed" style={{ color: "#707070" }}>
          We&apos;re currently writing some amazing content for you. Check back
          soon for the latest news, updates, and articles on AI in education!
        </p>
        <div className="mt-10">
          <Link
            href="/"
            className="inline-block rounded-full px-8 py-3 text-sm font-bold transition-transform hover:scale-105"
            style={{
              background: "var(--es-action-primary)",
              color: "var(--es-on-primary)",
            }}
          >
            Explore SonaAI
          </Link>
        </div>
      </div>
    </div>
  );
}
