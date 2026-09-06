"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  Sparkles,
  PhoneOff,
  LayoutGrid,
  Users,
  CheckCircle,
  Video,
  Camera,
  Hand,
  MonitorUp,
  MoreHorizontal,
  X,
  ChevronLeft,
} from "lucide-react";
import type { ParticipantPresence } from "@/types/conversation";

export type ClassroomConversationLayoutProps = {
  statusPanel: ReactNode;
  pipelineMetrics: ReactNode;
  transcriptPanel: ReactNode;
  visualizer: ReactNode;
  controls: ReactNode;
  micSelector: ReactNode;
  /** Teacher-only AUTO / ASK / MUTE dial, rendered beside the dock. */
  aiModeControl?: ReactNode;
  /** SonaAI's live state pill, rendered on its tile. */
  aiStateBadge?: ReactNode;
  /** SonaAI asking permission. Floats above the dock; absent means nothing is pending. */
  interventionCard?: ReactNode;
  /** Signals and decisions, shown in the AI Assistant tab in place of the static blurb. */
  signalPanel?: ReactNode;
  /** What this class is, e.g. the classroom code. */
  sessionTitle?: string;
  /** Live participant count, including SonaAI. */
  participantCount?: number;
  /** Named human participants currently known through RTM presence messages. */
  participants?: ParticipantPresence[];
  teacherName?: string;
  onCopyInviteLink?: () => void;
  inviteCopied?: boolean;
  chatInput: ReactNode;
  onEndConversation: () => void;
};

/** mm:ss, or h:mm:ss once a class runs long. */
function formatElapsed(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function ClassroomConversationLayout({
  statusPanel,
  pipelineMetrics,
  transcriptPanel,
  visualizer,
  controls,
  micSelector,
  aiModeControl,
  aiStateBadge,
  interventionCard,
  signalPanel,
  sessionTitle,
  participantCount,
  participants = [],
  teacherName = "Teacher",
  onCopyInviteLink,
  inviteCopied = false,
  chatInput,
  onEndConversation,
}: ClassroomConversationLayoutProps) {
  const [activeTab, setActiveTab] = useState<
    "ai" | "notes" | "transcript" | "qa"
  >("transcript");
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  // Real elapsed time for this session. The header used to show a fixed string, which is the
  // kind of detail that quietly makes a demo look staged.
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  useEffect(() => {
    const startedAt = Date.now();
    const id = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const glassPanel = {
    background: "rgba(255, 255, 255, 0.6)",
    backdropFilter: "blur(24px)",
    WebkitBackdropFilter: "blur(24px)",
    border: "1px solid rgba(255, 255, 255, 0.4)",
    boxShadow: "0 8px 32px rgba(0,0,0,0.05)",
  };

  return (
    <div className="flex h-screen w-full flex-col bg-[#F8F9FA] relative">
      {/* Header */}
      <header className="flex shrink-0 items-center justify-between px-6 py-4">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5">
          <img
            src="/SonaAI%20icon1.png"
            alt="SonaAI Logo"
            className="h-8 w-8 object-contain bg-white p-1 rounded-xl shadow-sm"
          />
          <span className="text-xl font-extrabold tracking-tight text-[#031A10] font-manrope">
            SonaAI Meet{" "}
            <span className="bg-[#D0FFA2] text-xs px-2 py-0.5 rounded-md ml-1">
              AI
            </span>
          </span>
        </Link>

        {/* Title */}
        <div className="items-center gap-4 hidden md:flex ml-12 flex-1">
          <span className="font-bold text-[#031A10]">
            {sessionTitle ?? "Live Class"}
          </span>
          <span className="text-gray-500 text-sm flex items-center gap-1">
            {formatElapsed(elapsedSeconds)}{" "}
            <CheckCircle className="w-4 h-4 text-green-600" />
          </span>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-3">
          {onCopyInviteLink && (
            <button
              type="button"
              onClick={onCopyInviteLink}
              className="hidden md:flex items-center gap-1.5 rounded-full bg-white/70 px-3 py-1.5 text-sm font-semibold text-[#031A10] transition-colors hover:bg-white"
              title="Copy a link students can use to join this class"
            >
              {inviteCopied ? "Invite link copied" : "Invite students"}
            </button>
          )}
          {statusPanel}
          <div
            className="hidden sm:flex min-w-0 flex-col justify-center gap-0.5 mr-4"
            style={
              {
                "--es-text-primary": "#031A10",
                "--es-text-muted": "#6B7280",
                "--es-border-subtle": "#E5E7EB",
              } as any
            }
          >
            {pipelineMetrics}
          </div>
          <button className="hidden lg:flex items-center gap-1.5 bg-white/60 hover:bg-white/80 px-3 py-1.5 rounded-full text-sm font-semibold transition-colors text-[#031A10]">
            <Users className="w-4 h-4" /> {participantCount ?? 1}
            <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse ml-0.5" />
          </button>
          <div className="h-8 w-8 rounded-full bg-[#D0FFA2] text-[#031A10] font-bold flex items-center justify-center shadow-sm">
            T
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex flex-1 min-h-0 gap-4 p-4 pt-0">
        {/* Left Stage (Video Grid) */}
        <div className="flex-1 flex flex-col relative rounded-[32px] overflow-hidden bg-[#0B0C10] shadow-2xl p-4 md:p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-full pb-24 w-full max-w-5xl mx-auto">
            {/* Tile 1: You (Teacher) */}
            <div className="relative rounded-2xl overflow-hidden flex items-center justify-center bg-[#1F2833]">
              <div className="flex h-24 w-24 items-center justify-center rounded-full bg-[#D0FFA2] text-4xl font-black text-[#031A10]">
                {teacherName.trim().charAt(0).toUpperCase()}
              </div>
              <div className="absolute top-3 left-3 bg-[#D0FFA2] text-[#031A10] text-[10px] font-bold px-2 py-1 rounded-full flex items-center gap-1 shadow-sm">
                Speaking{" "}
                <div className="flex gap-0.5">
                  {[1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="w-0.5 h-2 bg-[#031A10] rounded-full animate-pulse-subtle"
                    />
                  ))}
                </div>
              </div>
              <span className="absolute bottom-3 left-3 text-white text-sm font-semibold drop-shadow-md">
                {teacherName} (Teacher)
              </span>
            </div>

            {participants
              .filter((participant) => participant.role === "student")
              .map((participant) => (
                <div
                  key={participant.uid}
                  className="relative flex min-h-40 items-center justify-center overflow-hidden rounded-2xl bg-[#202A35]"
                >
                  <div className="flex h-20 w-20 items-center justify-center rounded-full bg-white/90 text-3xl font-black text-[#17305F]">
                    {participant.name.trim().charAt(0).toUpperCase()}
                  </div>
                  <span className="absolute bottom-3 left-3 flex items-center gap-2 text-sm font-semibold text-white drop-shadow-md">
                    {participant.name}{" "}
                    <span className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-bold uppercase">
                      Student
                    </span>
                  </span>
                </div>
              ))}

            {/* Tile 2: SonaAI */}
            <div className="relative rounded-2xl overflow-hidden flex flex-col items-center justify-center bg-[#052329] border border-[#D0FFA2]/30">
              <div className="flex items-center justify-center">
                {visualizer}
              </div>
              {aiStateBadge && (
                <div className="absolute top-3 left-3">{aiStateBadge}</div>
              )}
              <span className="absolute bottom-3 left-3 text-[#D0FFA2] text-sm font-semibold flex items-center gap-1.5 drop-shadow-md">
                <Sparkles className="w-3.5 h-3.5" /> SonaAI
              </span>
              <div className="absolute top-3 right-3 bg-black/40 rounded-full p-1.5">
                <MoreHorizontal className="w-4 h-4 text-white" />
              </div>
            </div>
          </div>

          {/* SonaAI asking permission — sits directly above the dock so the teacher's eyes
              never have to leave the class to answer it. */}
          {interventionCard && (
            <div className="absolute bottom-28 left-0 right-0 z-20 flex justify-center px-6">
              {interventionCard}
            </div>
          )}

          {/* Floating Control Dock */}
          <div className="absolute bottom-6 left-0 right-0 flex items-center justify-center px-6">
            <div className="flex items-center gap-3 bg-[#202124] rounded-full px-6 py-3 shadow-2xl border border-white/5">
              {/* Mic button with hover-reveal settings */}
              <div className="relative group/mic flex items-center">
                {controls}
                {/* Popup with invisible bridge padding so hover doesn't break */}
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 pb-2 opacity-0 group-hover/mic:opacity-100 transition-opacity duration-200 pointer-events-none group-hover/mic:pointer-events-auto">
                  <div className="bg-[#202124] rounded-full p-1 shadow-xl border border-white/10">
                    {micSelector}
                  </div>
                </div>
              </div>

              <button
                className="w-12 h-12 rounded-full bg-[#3C4043] flex items-center justify-center hover:bg-[#4d5155] transition-colors text-white/80 hover:text-white"
                title="Camera"
              >
                <Video className="w-5 h-5" />
              </button>
              <button
                className="hidden sm:flex w-12 h-12 rounded-full bg-[#3C4043] items-center justify-center hover:bg-[#4d5155] transition-colors text-white/80 hover:text-white"
                title="Raise Hand"
              >
                <Hand className="w-5 h-5" />
              </button>
              <button
                className="hidden md:flex w-12 h-12 rounded-full bg-[#3C4043] items-center justify-center hover:bg-[#4d5155] transition-colors text-white/80 hover:text-white"
                title="Share Screen"
              >
                <MonitorUp className="w-5 h-5" />
              </button>
              <button
                className="hidden sm:flex w-12 h-12 rounded-full bg-[#3C4043] items-center justify-center hover:bg-[#4d5155] transition-colors text-white/80 hover:text-white"
                title="More"
              >
                <MoreHorizontal className="w-5 h-5" />
              </button>

              {/* Separator */}
              <div className="w-px h-8 bg-white/10" />

              {/* End Call */}
              <button
                onClick={onEndConversation}
                className="w-14 h-12 rounded-full bg-[#EA4335] flex items-center justify-center hover:bg-[#d93025] transition-colors shadow-lg"
                title="Leave meeting"
              >
                <PhoneOff className="w-5 h-5 text-white" />
              </button>
            </div>

            {/* AUTO / ASK / MUTE — right side, same row as the dock */}
            {aiModeControl && (
              <div className="absolute right-6">{aiModeControl}</div>
            )}
          </div>
        </div>

        {/* Right Sidebar (Tabs) */}
        {isSidebarOpen && (
          <div
            className="w-[30%] hidden lg:flex flex-col rounded-[32px] overflow-hidden shadow-xl p-6 transition-all duration-300 shrink-0"
            style={glassPanel}
          >
            {/* Tabs & Close */}
            <div className="flex items-center justify-between border-b border-black/10 pb-4 mb-4 shrink-0">
              <div className="flex items-center gap-1">
                {(["transcript", "qa", "notes", "ai"] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`text-sm font-bold px-3 py-1.5 transition-colors relative ${activeTab === tab ? "text-[#031A10]" : "text-gray-400 hover:text-gray-700"}`}
                  >
                    {tab === "ai"
                      ? "AI Assistant"
                      : tab === "qa"
                        ? "Q&A"
                        : tab.charAt(0).toUpperCase() + tab.slice(1)}
                    {activeTab === tab && (
                      <div className="absolute -bottom-4 left-0 right-0 h-[3px] rounded-t-full bg-[#031A10]" />
                    )}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setIsSidebarOpen(false)}
                className="p-1 hover:bg-black/5 rounded-full transition-colors -mr-2"
                title="Close sidebar"
              >
                <X className="w-5 h-5 text-gray-400 hover:text-gray-800" />
              </button>
            </div>

            {/* Tab Content */}
            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar relative">
              {/* Transcript tab - blended with sidebar, no dark window */}
              {activeTab === "transcript" && (
                <div className="h-full flex flex-col">{transcriptPanel}</div>
              )}

              {/* AI Assistant tab — the engine's own view when we have one (teacher),
                otherwise a plain description of what SonaAI does (students). */}
              {activeTab === "ai" &&
                (signalPanel ? (
                  <div className="flex flex-col gap-4">{signalPanel}</div>
                ) : (
                  <div className="flex flex-col gap-4 h-full">
                    <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 flex items-center gap-4">
                      <img
                        src="/SonaAI%20icon1.png"
                        className="w-14 h-14 object-contain rounded-xl shrink-0"
                      />
                      <div>
                        <p className="text-sm font-bold text-[#031A10] flex items-center gap-1.5">
                          <Sparkles className="w-4 h-4 text-green-500" /> SonaAI
                          Co-Teacher
                        </p>
                        <p className="text-xs text-gray-500 mt-1.5 leading-relaxed">
                          Your AI co-teacher is here to help explain concepts,
                          answer questions, and support the classroom experience
                          in real-time.
                        </p>
                      </div>
                    </div>

                    <div className="bg-white/50 rounded-2xl p-4 border border-gray-100">
                      <h4 className="text-xs font-bold text-[#031A10] mb-2">
                        What SonaAI can do
                      </h4>
                      <ul className="text-xs text-gray-600 space-y-2 list-disc pl-4">
                        <li>Answer student questions in real-time</li>
                        <li>Explain complex topics with examples</li>
                        <li>Generate quizzes and summaries</li>
                        <li>Take notes during the session</li>
                      </ul>
                    </div>
                  </div>
                ))}

              {/* Q&A and Notes - placeholder */}
              {(activeTab === "notes" || activeTab === "qa") && (
                <div className="flex items-center justify-center h-full text-gray-400 text-sm font-medium">
                  Coming Soon
                </div>
              )}
            </div>

            {/* Ask SonaAI Chat input area - always visible */}
            <div className="mt-4 pt-4 border-t border-black/10 shrink-0">
              <div className="mb-2">
                <h3 className="text-sm font-bold text-[#031A10]">Ask SonaAI</h3>
              </div>
              <div className="flex flex-wrap gap-2 mb-3">
                <button className="text-xs font-semibold text-gray-600 bg-white hover:bg-gray-50 rounded-full px-3 py-1.5 shadow-sm border border-gray-200 whitespace-nowrap transition-colors">
                  What are the key decisions?
                </button>
                <button className="text-xs font-semibold text-gray-600 bg-white hover:bg-gray-50 rounded-full px-3 py-1.5 shadow-sm border border-gray-200 whitespace-nowrap transition-colors">
                  Summarize the last 10 minutes
                </button>
              </div>
              {chatInput}
            </div>
          </div>
        )}

        {/* Sidebar Open Toggle */}
        {!isSidebarOpen && (
          <button
            onClick={() => setIsSidebarOpen(true)}
            className="hidden lg:flex absolute right-0 top-[104px] bg-white/80 hover:bg-white backdrop-blur-md shadow-xl border border-r-0 border-white/40 py-4 px-2 rounded-l-2xl items-center justify-center transition-all group z-50 cursor-pointer"
            title="Open Sidebar"
          >
            <ChevronLeft className="w-6 h-6 text-gray-500 group-hover:text-[#031A10] group-hover:-translate-x-0.5 transition-all" />
          </button>
        )}
      </div>
    </div>
  );
}
