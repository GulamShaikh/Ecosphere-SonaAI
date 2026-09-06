"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Users,
  ArrowRight,
  BookOpen,
  Calendar,
  Camera,
  Trophy,
  ChevronRight,
  Plus,
  Check,
  Video,
  ChevronLeft,
  Activity,
} from "lucide-react";
import type { UserRole } from "@/types/conversation";
import DashboardCalendar from "./DashboardCalendar";
import DashboardTasks from "./DashboardTasks";
import HistoryModal from "./HistoryModal";
import { supabase } from "@/lib/supabaseClient";

type SessionData = {
  name: string;
  role: UserRole;
  avatar_url?: string;
};

const glassPanel = {
  background: "rgba(255, 255, 255, 0.6)",
  backdropFilter: "blur(40px)",
  WebkitBackdropFilter: "blur(40px)",
  border: "1px solid rgba(255, 255, 255, 0.4)",
  boxShadow: "0 8px 32px rgba(0,0,0,0.05)",
};

export default function StudentDashboard({
  session,
  onAvatarUpload,
}: {
  session: SessionData;
  onAvatarUpload?: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  const router = useRouter();
  const [studentCode, setStudentCode] = useState("");
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [totalClassesAttended, setTotalClassesAttended] = useState<
    number | string
  >("...");
  const today = new Date();
  const currentMonth = today.toLocaleString("default", { month: "long" });
  const currentYear = today.getFullYear();
  const currentDate = today.getDate();

  const [selectedDate, setSelectedDate] = useState<Date>(today);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const joinCode = new URLSearchParams(window.location.search).get("join");
    if (joinCode) setStudentCode(joinCode.toUpperCase());

    // Fetch Stats
    const fetchStats = async () => {
      const {
        data: { session: supaSession },
      } = await supabase.auth.getSession();
      if (!supaSession) return;

      const { count } = await supabase
        .from("sessions_history")
        .select("*", { count: "exact", head: true })
        .eq("user_id", supaSession.user.id)
        .eq("role", "student");

      setTotalClassesAttended(count || 0);
    };
    fetchStats();
  }, []);

  const handleJoinAsStudent = useCallback(async () => {
    if (!session || !studentCode.trim()) return;

    // Log session to history
    const {
      data: { session: supaSession },
    } = await supabase.auth.getSession();
    if (supaSession) {
      await supabase.from("sessions_history").insert({
        user_id: supaSession.user.id,
        role: "student",
        class_code: studentCode.trim(),
      });
    }

    sessionStorage.setItem(
      "echosphere_meeting",
      JSON.stringify({
        name: session.name,
        role: session.role,
        classroomCode: studentCode.trim().toUpperCase(),
      }),
    );
    router.push("/meeting");
  }, [session, studentCode, router]);

  return (
    <div className="grid h-full w-full grid-cols-1 md:grid-cols-4 md:grid-rows-3 gap-6 animate-fade-in pb-4">
      {/* 1. Profile Card (Spans 1 Col, 2 Rows) */}
      <div
        className="col-span-1 md:row-span-2 rounded-[24px] relative overflow-hidden group flex flex-col justify-end"
        style={{ ...glassPanel, padding: 0 }}
      >
        <div
          className="absolute inset-0 bg-cover bg-center z-0 transition-transform duration-500 group-hover:scale-105"
          style={{
            backgroundImage: session.avatar_url
              ? `url(${session.avatar_url})`
              : 'url("/hero_classroom_1788611365675.jpg")',
            backgroundPosition: "center 20%",
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#031A10]/90 via-[#031A10]/30 to-transparent z-10" />

        {/* Photo Upload Overlay Button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          className="absolute top-4 right-4 z-30 p-2.5 rounded-full bg-black/40 backdrop-blur-md border border-white/30 text-white transition-colors duration-200 hover:bg-black/60 shadow-lg"
          title="Update Profile Photo"
        >
          <Camera className="w-5 h-5" />
        </button>
        <input
          type="file"
          ref={fileInputRef}
          onChange={onAvatarUpload}
          accept="image/*"
          className="hidden"
        />

        <div className="relative z-20 p-6">
          <h2 className="text-2xl font-bold text-white mb-1 tracking-tight font-manrope">
            {session.name}
          </h2>
          <div className="flex items-center justify-between">
            <p className="text-[#D0FFA2] text-sm font-medium capitalize">
              {session.role}
            </p>
            <span className="px-3 py-1 rounded-full border border-white/30 bg-white/10 text-white text-xs font-medium backdrop-blur-sm">
              Online
            </span>
          </div>
        </div>
      </div>

      {/* 2. Join Class Widget (Spans 2 Cols, 1 Row) */}
      <div
        className="col-span-1 md:col-span-2 md:row-span-1 rounded-[24px] p-6 flex flex-col justify-between"
        style={glassPanel}
      >
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-2xl font-bold text-[#031A10] font-manrope tracking-tight">
              Join a Class
            </h3>
            <p className="text-gray-600 text-sm mt-1">
              Enter the 6-character code from your teacher
            </p>
          </div>
          <div className="h-12 w-12 rounded-xl bg-[#D0FFA2]/20 flex items-center justify-center text-[#031A10]">
            <Users className="w-6 h-6" />
          </div>
        </div>

        <div className="flex items-center gap-4 mt-4">
          <input
            type="text"
            value={studentCode}
            onChange={(e) =>
              setStudentCode(e.target.value.toUpperCase().replace(/\s/g, ""))
            }
            placeholder="A1B2C3"
            autoComplete="off"
            maxLength={6}
            className="flex-1 bg-white/50 border border-white/60 rounded-xl px-5 py-4 text-2xl font-black uppercase tracking-[0.2em] outline-none transition-all duration-200 text-[#031A10] font-mono shadow-sm focus:border-[#031A10]"
          />
        </div>
      </div>

      {/* 3. Stats Widget (Spans 1 Col, 1 Row) */}
      <div
        className="col-span-1 md:row-span-1 rounded-[24px] p-6 flex flex-col justify-between"
        style={glassPanel}
      >
        <div className="flex justify-between items-start">
          <h3 className="text-lg font-bold text-[#031A10] font-manrope">
            Attendance
          </h3>
          <div className="p-2 rounded-full bg-white/40 border border-white/60 text-[#031A10]">
            <Activity className="w-4 h-4" />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-4xl font-black text-[#031A10] font-manrope">
            {totalClassesAttended}
          </span>
          <span className="text-sm font-medium text-gray-500">
            Classes Attended
          </span>
        </div>
      </div>

      {/* 4. Quick Actions & Primary CTA (Spans 3 Cols, 1 Row) */}
      <div className="col-span-1 md:col-span-3 md:row-span-1 flex flex-col md:flex-row gap-6">
        {/* Left Side: Secondary Actions */}
        <div className="flex-1 grid grid-cols-2 gap-4">
          <button
            onClick={() => router.push("/materials")}
            className="rounded-[24px] p-5 flex flex-col items-start justify-between text-left transition-transform duration-200 hover:scale-[1.02] active:scale-[0.98]"
            style={glassPanel}
          >
            <div className="h-10 w-10 rounded-full bg-white/60 shadow-sm flex items-center justify-center text-[#031A10] mb-2">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <p className="font-bold text-[#031A10] text-sm">
                Study Materials
              </p>
              <p className="text-xs text-gray-500 mt-0.5">Review past notes</p>
            </div>
          </button>

          <button
            onClick={() => setIsHistoryModalOpen(true)}
            className="rounded-[24px] p-5 flex flex-col items-start justify-between text-left transition-transform duration-200 hover:scale-[1.02] active:scale-[0.98]"
            style={glassPanel}
          >
            <div className="h-10 w-10 rounded-full bg-white/60 shadow-sm flex items-center justify-center text-[#031A10] mb-2">
              <Trophy className="w-5 h-5" />
            </div>
            <div>
              <p className="font-bold text-[#031A10] text-sm">Achievements</p>
              <p className="text-xs text-gray-500 mt-0.5">View your progress</p>
            </div>
          </button>
        </div>

        {/* Right Side: Big Join Button */}
        <div className="flex-1">
          <button
            onClick={handleJoinAsStudent}
            disabled={studentCode.trim().length < 4}
            className="w-full h-full rounded-[24px] p-6 flex items-center justify-between shadow-xl transition-transform duration-300 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:hover:scale-100"
            style={{
              background: "#031A10",
              border: "1px solid rgba(255,255,255,0.1)",
            }}
          >
            <div className="flex flex-col items-start text-left">
              <span className="text-[#D0FFA2] text-sm font-bold uppercase tracking-wider mb-1">
                Class Code Ready
              </span>
              <span className="text-white text-3xl font-black font-manrope tracking-tight">
                Join
                <br />
                Classroom
              </span>
            </div>
            <div className="h-16 w-16 rounded-full bg-[#D0FFA2] flex items-center justify-center shadow-[0_0_30px_rgba(208,255,162,0.3)]">
              <ArrowRight className="w-8 h-8 text-[#031A10]" />
            </div>
          </button>
        </div>
      </div>

      {/* 5. Calendar (Spans 2 Cols, 1 Row) */}
      <DashboardCalendar
        selectedDate={selectedDate}
        onSelectDate={setSelectedDate}
      />

      {/* 6. Tasks (Spans 2 Cols, 1 Row) */}
      <DashboardTasks selectedDate={selectedDate} />

      <HistoryModal
        isOpen={isHistoryModalOpen}
        onClose={() => setIsHistoryModalOpen(false)}
        role="student"
      />
    </div>
  );
}
