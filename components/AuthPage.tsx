"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Sparkles,
  ArrowRight,
  Loader2,
  Github,
  Eye,
  EyeOff,
  Check,
  X,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { UserRole } from "@/types/conversation";
import { supabase } from "@/lib/supabaseClient";

export default function AuthPage() {
  const router = useRouter();
  const [tab, setTab] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("demo@echosphere.edu");
  const [password, setPassword] = useState("teacher123");
  const [role, setRole] = useState<UserRole>("student");
  const [isLoading, setIsLoading] = useState(false);
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [touched, setTouched] = useState({
    name: false,
    email: false,
    password: false,
    confirmPassword: false,
  });

  const [passwordFocused, setPasswordFocused] = useState(false);
  const [passwordHovered, setPasswordHovered] = useState(false);
  const joinCode =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("join")
      : null;

  // Password validation logic
  const hasMinLength = password.length >= 8;
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecial = /[^A-Za-z0-9]/.test(password);
  const isPasswordValid =
    hasMinLength && hasUpper && hasLower && hasNumber && hasSpecial;
  const showValidationUI = tab === "signup";

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEmail(e.target.value);
  };

  useEffect(() => {
    const checkSession = async () => {
      const stored = sessionStorage.getItem("echosphere_session");
      if (stored) {
        router.replace("/dashboard");
        return;
      }
      const {
        data: { session: supaSession },
      } = await supabase.auth.getSession();
      if (supaSession) {
        router.replace("/dashboard");
      }
    };
    checkSession();
  }, [router]);

  const canSubmit =
    tab === "signin"
      ? email.trim().length > 0 && password.length > 0
      : name.trim().length > 0 &&
        isPasswordValid &&
        password === confirmPassword &&
        !isLoading;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setIsLoading(true);

    // Real Supabase Auth
    try {
      if (tab === "signup") {
        const { data: authData, error: authError } = await supabase.auth.signUp(
          {
            email,
            password,
            options: {
              data: { name, role },
            },
          },
        );
        if (authError) throw authError;

        // If email verification is required, session will be null
        if (!authData.session) {
          alert(
            "Success! Please check your email for a verification link before logging in.",
          );
          setIsLoading(false);
          setTab("signin");
          return;
        }

        router.push(
          joinCode
            ? `/meeting?join=${encodeURIComponent(joinCode)}`
            : "/dashboard",
        );
      } else {
        const { data: authData, error: authError } =
          await supabase.auth.signInWithPassword({
            email,
            password,
          });
        if (authError) throw authError;

        router.push(
          joinCode
            ? `/meeting?join=${encodeURIComponent(joinCode)}`
            : "/dashboard",
        );
      }
    } catch (error: any) {
      alert(error.message || "An error occurred during authentication");
      setIsLoading(false);
    }
  };

  const handleOAuth = async (provider: "google" | "github") => {
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}${joinCode ? `/meeting?join=${encodeURIComponent(joinCode)}` : "/dashboard"}`,
        },
      });
      if (error) throw error;
    } catch (error: any) {
      alert(error.message);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return alert("Please enter your email address");
    setIsLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      alert("Password reset link sent! Check your email.");
      setIsResettingPassword(false);
    } catch (error: any) {
      alert(error.message || "Failed to send reset link");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className="flex h-[100dvh] overflow-hidden flex-col items-center justify-center px-4 bg-center bg-cover bg-no-repeat bg-fixed"
      style={{ backgroundImage: 'url("/Auth-Bg.png")' }}
    >
      {/* Back to home */}
      <Link
        href="/"
        className="absolute top-6 left-6 flex items-center gap-2 text-sm font-medium transition-opacity hover:opacity-70"
        style={{ color: "#707070" }}
      >
        <ArrowRight className="h-3.5 w-3.5 rotate-180" />
        Back
      </Link>

      <div
        className="animate-slide-up-enter w-full max-w-md max-h-[90vh] overflow-y-auto [&::-webkit-scrollbar]:hidden rounded-xl p-8 md:p-10 shadow-2xl shadow-black/10"
        data-lenis-prevent="true"
        style={{
          border: "1px solid rgba(0,0,0,0.06)",
          background: "#FFFFFF",
          scrollbarWidth: "none",
          msOverflowStyle: "none",
        }}
      >
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center">
          <img
            src="/SonaAI%20icon1.png"
            alt="SonaAI Logo"
            className="mb-4 h-16 w-16 object-contain bg-white p-1.5"
            style={{
              borderRadius: "16px",
              boxShadow: "0 4px 12px rgba(0,0,0,0.05)",
            }}
          />
          <h1
            className="text-2xl font-extrabold"
            style={{
              color: "#000000",
              letterSpacing: "-1.44px",
              fontFamily: "var(--font-manrope)",
            }}
          >
            Welcome to SonaAI
          </h1>
          <p
            className="mt-1.5 text-sm"
            style={{ color: "#707070", letterSpacing: "normal" }}
          >
            {tab === "signin"
              ? "Sign in to your classroom"
              : "Create your account"}
          </p>
        </div>

        {/* Tab toggle */}
        {!isResettingPassword && (
          <div
            className="mb-6 flex rounded-full p-1"
            style={{ background: "#F5F5F5" }}
            role="tablist"
          >
            {(["signin", "signup"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => {
                  if (t === "signup") {
                    setEmail("");
                    setPassword("");
                    setConfirmPassword("");
                    setName("");
                    setTouched({
                      name: false,
                      email: false,
                      password: false,
                      confirmPassword: false,
                    });
                  }
                  setTab(t);
                }}
                className="flex-1 rounded-full py-2 text-sm font-medium transition-all duration-200"
                style={{
                  background: tab === t ? "#FFFFFF" : "transparent",
                  color: tab === t ? "#000000" : "#707070",
                  letterSpacing: "-0.32px",
                }}
              >
                {t === "signin" ? "Sign In" : "Sign Up"}
              </button>
            ))}
          </div>
        )}

        {!isResettingPassword && (
          <>
            {/* Social Logins */}
            <div className="mb-6 flex gap-3">
              <button
                type="button"
                onClick={() => handleOAuth("google")}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium transition-colors hover:bg-gray-50"
                style={{
                  border: "1px solid rgba(0,0,0,0.12)",
                  color: "#000000",
                }}
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
                  <path
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    fill="#4285F4"
                  />
                  <path
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    fill="#34A853"
                  />
                  <path
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    fill="#FBBC05"
                  />
                  <path
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    fill="#EA4335"
                  />
                </svg>
                Google
              </button>
              <button
                type="button"
                onClick={() => handleOAuth("github")}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium transition-colors hover:bg-gray-50"
                style={{
                  border: "1px solid rgba(0,0,0,0.12)",
                  color: "#000000",
                }}
              >
                <Github className="h-4 w-4" />
                GitHub
              </button>
            </div>

            <div className="relative mb-6">
              <div className="absolute inset-0 flex items-center">
                <div
                  className="w-full border-t"
                  style={{ borderColor: "rgba(0,0,0,0.12)" }}
                ></div>
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-white px-2" style={{ color: "#707070" }}>
                  Or continue with email
                </span>
              </div>
            </div>
          </>
        )}

        {isResettingPassword ? (
          <form onSubmit={handleResetPassword}>
            <div className="mb-4">
              <label
                htmlFor="reset-email"
                className="mb-1.5 block text-xs font-medium"
                style={{ color: "#707070" }}
              >
                Email address
              </label>
              <input
                id="reset-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="alex@university.edu"
                required
                className="w-full rounded-lg px-4 py-2.5 text-sm outline-none transition-all duration-200"
                style={{
                  border: "1px solid rgba(0,0,0,0.12)",
                  background: "#F5F5F5",
                  color: "#000000",
                }}
              />
            </div>
            <motion.button
              type="submit"
              disabled={!email || isLoading}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-full py-3 text-sm font-bold"
              style={{
                backgroundColor: email && !isLoading ? "#031A10" : "#E5E7EB",
                color: email && !isLoading ? "#D0FFA2" : "#9CA3AF",
              }}
              whileHover={
                email && !isLoading
                  ? {
                      scale: 1.02,
                      backgroundColor: "#D0FFA2",
                      color: "#031A10",
                    }
                  : {}
              }
              whileTap={email && !isLoading ? { scale: 0.98 } : {}}
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Send Reset Link"
              )}
            </motion.button>

            <p className="mt-6 text-center text-xs">
              <button
                type="button"
                onClick={() => setIsResettingPassword(false)}
                className="font-medium underline transition-opacity hover:opacity-70 text-gray-800"
              >
                Back to Sign In
              </button>
            </p>
          </form>
        ) : (
          <form onSubmit={handleSubmit}>
            {/* Name (sign up only) */}
            <AnimatePresence initial={false}>
              {tab === "signup" && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.3, ease: "easeInOut" }}
                  className="overflow-hidden"
                >
                  <div className="mb-4">
                    <label
                      htmlFor="auth-name"
                      className="mb-1.5 block text-xs font-medium"
                      style={{ color: "#707070", letterSpacing: "normal" }}
                    >
                      Your name <span className="text-red-500">*</span>
                    </label>
                    <input
                      id="auth-name"
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. Alex Johnson"
                      autoComplete="name"
                      maxLength={64}
                      className="w-full rounded-lg px-4 py-2.5 text-sm outline-none transition-all duration-200"
                      style={{
                        border: "1px solid",
                        borderColor:
                          touched.name && name.trim().length === 0
                            ? "#EF4444"
                            : "rgba(0,0,0,0.12)",
                        background:
                          touched.name && name.trim().length === 0
                            ? "#FEF2F2"
                            : "#F5F5F5",
                        color: "#000000",
                        letterSpacing: "normal",
                      }}
                      onFocus={(e) => {
                        e.currentTarget.style.borderColor = "#031A10";
                      }}
                      onBlur={(e) => {
                        setTouched((prev) => ({ ...prev, name: true }));
                        e.currentTarget.style.borderColor =
                          touched.name && name.trim().length === 0
                            ? "#EF4444"
                            : "rgba(0,0,0,0.12)";
                      }}
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Email (Always visible) */}
            <div className="mb-4">
              <label
                htmlFor="auth-email"
                className="mb-1.5 block text-xs font-medium"
                style={{ color: "#707070", letterSpacing: "normal" }}
              >
                Email address <span className="text-red-500">*</span>
              </label>
              <input
                id="auth-email"
                type="email"
                value={email}
                onChange={handleEmailChange}
                placeholder="alex@university.edu"
                autoComplete="email"
                maxLength={128}
                className="w-full rounded-lg px-4 py-2.5 text-sm outline-none transition-all duration-200"
                style={{
                  border: "1px solid",
                  borderColor:
                    touched.email && email.trim().length === 0
                      ? "#EF4444"
                      : "rgba(0,0,0,0.12)",
                  background:
                    touched.email && email.trim().length === 0
                      ? "#FEF2F2"
                      : "#F5F5F5",
                  color: "#000000",
                  letterSpacing: "normal",
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = "#031A10";
                }}
                onBlur={(e) => {
                  setTouched((prev) => ({ ...prev, email: true }));
                  e.currentTarget.style.borderColor =
                    touched.email && email.trim().length === 0
                      ? "#EF4444"
                      : "rgba(0,0,0,0.12)";
                }}
              />
            </div>

            {/* Password (Always visible) */}
            <div className="mb-4">
              <label
                htmlFor="auth-password"
                className="mb-1.5 block text-xs font-medium"
                style={{ color: "#707070", letterSpacing: "normal" }}
              >
                Password <span className="text-red-500">*</span>
              </label>
              <div
                className="relative"
                onMouseEnter={() => setPasswordHovered(true)}
                onMouseLeave={() => setPasswordHovered(false)}
              >
                <input
                  id="auth-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  maxLength={128}
                  className="w-full rounded-lg px-4 py-2.5 text-sm outline-none transition-all duration-200"
                  style={{
                    border: "1px solid",
                    borderColor:
                      (showValidationUI &&
                        password.length > 0 &&
                        !isPasswordValid) ||
                      (touched.password && password.length === 0)
                        ? "#EF4444" // Red if invalid or empty when touched
                        : passwordFocused
                          ? "#031A10" // Black if focused
                          : "rgba(0,0,0,0.12)", // Default
                    background:
                      (showValidationUI &&
                        password.length > 0 &&
                        !isPasswordValid) ||
                      (touched.password && password.length === 0)
                        ? "#FEF2F2"
                        : "#F5F5F5",
                    color: "#000000",
                    letterSpacing: "normal",
                    paddingRight: "2.5rem",
                  }}
                  onFocus={() => setPasswordFocused(true)}
                  onBlur={() => {
                    setPasswordFocused(false);
                    setTouched((prev) => ({ ...prev, password: true }));
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 focus:outline-none"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>

              <AnimatePresence>
                {showValidationUI &&
                  !isPasswordValid &&
                  (passwordFocused ||
                    passwordHovered ||
                    password.length > 0) && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden mt-2"
                    >
                      <div className="p-3 bg-gray-50 rounded-lg border border-gray-100">
                        <h4 className="text-xs font-bold text-gray-900 mb-2">
                          Password Requirements:
                        </h4>
                        <ul className="space-y-1.5 text-xs text-gray-600">
                          {[
                            {
                              met: hasMinLength,
                              text: "At least 8 characters",
                            },
                            { met: hasUpper, text: "One uppercase letter" },
                            { met: hasLower, text: "One lowercase letter" },
                            { met: hasNumber, text: "One number" },
                            { met: hasSpecial, text: "One special character" },
                          ].map((req, i) => (
                            <li key={i} className="flex items-center gap-2">
                              {req.met ? (
                                <Check className="h-3 w-3 text-green-500" />
                              ) : (
                                <X className="h-3 w-3 text-red-400" />
                              )}
                              <span
                                className={
                                  req.met ? "text-green-700 font-medium" : ""
                                }
                              >
                                {req.text}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </motion.div>
                  )}
              </AnimatePresence>
            </div>

            <AnimatePresence>
              {showValidationUI && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="mb-4 overflow-hidden"
                >
                  <label
                    htmlFor="auth-confirm-password"
                    className="mb-1.5 block text-xs font-medium"
                    style={{ color: "#707070", letterSpacing: "normal" }}
                  >
                    Confirm Password <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      id="auth-confirm-password"
                      type={showConfirmPassword ? "text" : "password"}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="••••••••"
                      autoComplete="new-password"
                      maxLength={128}
                      className="w-full rounded-lg px-4 py-2.5 text-sm outline-none transition-all duration-200"
                      style={{
                        border: "1px solid",
                        borderColor:
                          touched.confirmPassword &&
                          (confirmPassword.length === 0 ||
                            confirmPassword !== password)
                            ? "#EF4444"
                            : "rgba(0,0,0,0.12)",
                        background:
                          touched.confirmPassword &&
                          (confirmPassword.length === 0 ||
                            confirmPassword !== password)
                            ? "#FEF2F2"
                            : "#F5F5F5",
                        color: "#000000",
                        letterSpacing: "normal",
                        paddingRight: "2.5rem",
                      }}
                      onFocus={(e) => {
                        e.currentTarget.style.borderColor = "#031A10";
                      }}
                      onBlur={(e) => {
                        setTouched((prev) => ({
                          ...prev,
                          confirmPassword: true,
                        }));
                        e.currentTarget.style.borderColor =
                          touched.confirmPassword &&
                          (confirmPassword.length === 0 ||
                            confirmPassword !== password)
                            ? "#EF4444"
                            : "rgba(0,0,0,0.12)";
                      }}
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setShowConfirmPassword(!showConfirmPassword)
                      }
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 focus:outline-none"
                    >
                      {showConfirmPassword ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {tab === "signin" && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="mt-2 flex justify-end"
                >
                  <button
                    type="button"
                    onClick={() => setIsResettingPassword(true)}
                    className="text-xs font-medium text-gray-600 hover:text-black underline transition-colors"
                  >
                    Forgot Password?
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Role selector (sign up only) */}
            <AnimatePresence initial={false}>
              {tab === "signup" && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.3, ease: "easeInOut" }}
                  className="overflow-hidden"
                >
                  <div className="mb-4">
                    <span
                      className="mb-1.5 block text-xs font-medium"
                      style={{ color: "#707070", letterSpacing: "normal" }}
                    >
                      I am a
                    </span>
                    <div
                      className="flex rounded-lg p-1"
                      style={{ border: "1px solid rgba(0,0,0,0.12)" }}
                      role="group"
                      aria-label="Select role"
                    >
                      {(["student", "teacher"] as UserRole[]).map((r) => (
                        <button
                          key={r}
                          type="button"
                          onClick={() => setRole(r)}
                          className="flex-1 rounded-md py-2 text-sm font-medium capitalize transition-all duration-200"
                          style={{
                            background: role === r ? "#031A10" : "transparent",
                            color: role === r ? "#D0FFA2" : "#707070",
                            letterSpacing: "-0.32px",
                          }}
                          aria-pressed={role === r}
                        >
                          {r.charAt(0).toUpperCase() + r.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Submit */}
            <motion.button
              type="submit"
              disabled={!canSubmit}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-full py-3 text-sm font-bold"
              initial={false}
              animate={{
                backgroundColor: canSubmit ? "#031A10" : "#E5E7EB",
                color: canSubmit ? "#D0FFA2" : "#9CA3AF",
                letterSpacing: "-0.16px",
              }}
              whileHover={
                canSubmit
                  ? {
                      scale: 1.02,
                      backgroundColor: "#D0FFA2",
                      color: "#031A10",
                    }
                  : {}
              }
              whileTap={canSubmit ? { scale: 0.98 } : {}}
              transition={{ duration: 0.2, ease: "easeOut" }}
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {tab === "signin" ? "Signing in…" : "Creating account…"}
                </>
              ) : (
                <>
                  {tab === "signin" ? "Continue" : "Create Account"}
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </motion.button>
          </form>
        )}

        {/* Footer link */}
        {!isResettingPassword && (
          <p
            className="mt-6 text-center text-xs"
            style={{ color: "#707070", letterSpacing: "normal" }}
          >
            {tab === "signin" ? (
              <>
                Don&apos;t have an account?{" "}
                <button
                  type="button"
                  onClick={() => setTab("signup")}
                  className="font-medium underline transition-opacity hover:opacity-70"
                  style={{ color: "#000000" }}
                >
                  Sign up
                </button>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <button
                  type="button"
                  onClick={() => setTab("signin")}
                  className="font-medium underline transition-opacity hover:opacity-70"
                  style={{ color: "#000000" }}
                >
                  Sign in
                </button>
              </>
            )}
          </p>
        )}
      </div>

      {/* Attribution */}
      <p className="mt-6 text-xs" style={{ color: "#707070" }}>
        Powered by{" "}
        <a
          href="https://agora.io/en/"
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium underline transition-opacity hover:opacity-70"
          style={{ color: "#333333" }}
        >
          Agora
        </a>
      </p>
    </div>
  );
}
