"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import {
  ArrowLeft,
  BookOpen,
  Plus,
  Loader2,
  Save,
  X,
  Paperclip,
  Download,
  Folder,
  Trash2,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

export default function MaterialsPage() {
  const router = useRouter();
  const [materials, setMaterials] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [subject, setSubject] = useState("General");
  const [file, setFile] = useState<File | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedNote, setSelectedNote] = useState<any>(null);
  const [selectedFolder, setSelectedFolder] = useState<string>("All");
  const [isFolderModalOpen, setIsFolderModalOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [customFolders, setCustomFolders] = useState<string[]>([]);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    let mounted = true;
    const fetchMaterials = async () => {
      setLoading(true);
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        if (mounted) router.push("/");
        return;
      }

      const { data, error } = await supabase
        .from("course_materials")
        .select("*")
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: false });

      if (mounted && !error) {
        setMaterials(data || []);
      }
      if (mounted) setLoading(false);
    };

    fetchMaterials();
    return () => {
      mounted = false;
    };
  }, [router]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || (!content.trim() && !file)) return;

    setIsSaving(true);
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return;

    let file_url = null;

    // Upload file if exists
    if (file) {
      const fileExt = file.name.split(".").pop();
      const fileName = `${crypto.randomUUID()}.${fileExt}`;
      const filePath = `${session.user.id}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from("materials_files")
        .upload(filePath, file);

      if (uploadError) {
        console.error("Upload error details:", uploadError);
        alert(
          `Failed to upload file: ${uploadError.message}. Did you enable RLS policies for the materials_files bucket?`,
        );
        setIsSaving(false);
        return;
      }

      const { data: publicUrlData } = supabase.storage
        .from("materials_files")
        .getPublicUrl(filePath);
      file_url = publicUrlData.publicUrl;
    }

    const { data, error } = await supabase
      .from("course_materials")
      .insert({
        user_id: session.user.id,
        title: title.trim(),
        content: content.trim() || "Attached Document",
        subject: subject.trim() || "General",
        file_url,
      })
      .select()
      .single();

    if (!error && data) {
      setMaterials((prev) => [data, ...prev]);
      closeModal();
    }
    setIsSaving(false);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setTitle("");
    setContent("");
    setSubject("General");
    setFile(null);
  };

  const handleDeleteNote = async (noteId: string) => {
    if (!confirm("Are you sure you want to delete this note?")) return;

    setIsDeleting(true);

    const { error } = await supabase
      .from("course_materials")
      .delete()
      .eq("id", noteId);

    if (!error) {
      setMaterials((prev) => prev.filter((n) => n.id !== noteId));
      setSelectedNote(null);
    } else {
      alert("Failed to delete note");
      console.error(error);
    }

    setIsDeleting(false);
  };

  const glassPanel = {
    background: "rgba(255, 255, 255, 0.6)",
    backdropFilter: "blur(40px)",
    border: "1px solid rgba(255, 255, 255, 0.4)",
    boxShadow: "0 8px 32px rgba(0,0,0,0.05)",
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans relative">
      <div
        className="absolute inset-0 bg-cover bg-center z-0 opacity-40"
        style={{ backgroundImage: 'url("/hero_classroom_1788611365675.jpg")' }}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-gray-50/80 to-gray-100/95 z-0" />

      <main className="flex-1 w-full max-w-[1600px] mx-auto px-4 md:px-8 pt-16 pb-12 z-10">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push("/dashboard")}
              className="p-3 bg-white/60 hover:bg-white/90 rounded-full transition-colors shadow-sm"
            >
              <ArrowLeft className="w-5 h-5 text-[#031A10]" />
            </button>
            <div>
              <h1 className="text-3xl font-black text-[#031A10] font-manrope">
                Course Materials
              </h1>
              <p className="text-sm font-medium text-gray-500 mt-1">
                Manage your class notes and resources
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={() => setIsFolderModalOpen(true)}
              className="flex items-center gap-2 px-6 py-3 rounded-full font-bold text-[#031A10] transition-transform hover:scale-105 active:scale-95 shadow-md bg-white hover:bg-gray-50 border border-gray-200"
            >
              <Folder className="w-4 h-4" />
              New Folder
            </button>
            <button
              onClick={() => {
                setSubject(
                  selectedFolder !== "All" ? selectedFolder : "General",
                );
                setIsModalOpen(true);
              }}
              className="flex items-center gap-2 px-6 py-3 rounded-full font-bold text-[#031A10] transition-transform hover:scale-105 active:scale-95 shadow-md"
              style={{ background: "#D0FFA2" }}
            >
              <Plus className="w-4 h-4" />
              Upload Notes
            </button>
          </div>
        </div>

        <div className="flex flex-col md:flex-row gap-8">
          {/* Sidebar */}
          <div className="w-full md:w-64 shrink-0">
            <div className="rounded-[24px] p-6" style={glassPanel}>
              <h3 className="text-sm font-bold text-[#031A10] mb-4 uppercase tracking-wider">
                Folders
              </h3>
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => setSelectedFolder("All")}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-colors text-sm font-medium ${
                    selectedFolder === "All"
                      ? "bg-[#031A10] text-white shadow-md"
                      : "hover:bg-white/50 text-[#031A10]/70 hover:text-[#031A10]"
                  }`}
                >
                  <Folder className="w-4 h-4" />
                  All Notes
                </button>
                {Array.from(
                  new Set([
                    ...materials.map((m) => m.subject || "General"),
                    ...customFolders,
                  ]),
                )
                  .sort()
                  .map((folder) => (
                    <button
                      key={folder}
                      onClick={() => setSelectedFolder(folder)}
                      className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-colors text-sm font-medium ${
                        selectedFolder === folder
                          ? "bg-[#031A10] text-white shadow-md"
                          : "hover:bg-white/50 text-[#031A10]/70 hover:text-[#031A10]"
                      }`}
                    >
                      <Folder className="w-4 h-4" />
                      {folder}
                    </button>
                  ))}
              </div>
            </div>
          </div>

          {/* Main Grid */}
          <div className="flex-1">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-24 opacity-50">
                <Loader2 className="w-8 h-8 text-[#031A10] animate-spin mb-4" />
                <p className="font-medium text-gray-600">
                  Loading materials...
                </p>
              </div>
            ) : materials.filter(
                (m) =>
                  selectedFolder === "All" ||
                  (m.subject || "General") === selectedFolder,
              ).length > 0 ? (
              <div className="flex flex-col gap-3">
                {/* Table Header */}
                <div className="hidden md:flex items-center px-4 py-3 text-xs font-bold text-[#031A10]/50 uppercase tracking-wider gap-4">
                  <div className="flex-1">Name</div>
                  <div className="w-32 text-left">Subject</div>
                  <div className="w-32 text-center">Attachment</div>
                  <div className="w-32 text-right">Last Modified</div>
                </div>
                {materials
                  .filter(
                    (m) =>
                      selectedFolder === "All" ||
                      (m.subject || "General") === selectedFolder,
                  )
                  .map((note) => (
                    <div
                      key={note.id}
                      onClick={() => setSelectedNote(note)}
                      className="rounded-2xl p-4 flex flex-col md:flex-row md:items-center transition-all duration-300 hover:bg-white/40 cursor-pointer border border-white/20 gap-4"
                      style={{
                        background: "rgba(255, 255, 255, 0.4)",
                        backdropFilter: "blur(40px)",
                        boxShadow: "0 4px 20px rgba(0,0,0,0.02)",
                      }}
                    >
                      {/* Name & Content Preview */}
                      <div className="flex items-center gap-4 flex-1">
                        <div className="p-3 rounded-xl bg-white/60 text-[#031A10] shrink-0">
                          {note.file_url ? (
                            <Paperclip className="w-5 h-5" />
                          ) : (
                            <BookOpen className="w-5 h-5" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="text-base font-bold text-[#031A10] font-manrope truncate">
                            {note.title}
                          </h3>
                          <p className="text-xs text-gray-500 truncate mt-1">
                            {note.content}
                          </p>
                        </div>
                      </div>

                      {/* Subject Badge */}
                      <div className="hidden md:flex w-32 items-center">
                        <span className="text-[10px] font-bold uppercase tracking-wider bg-white/50 px-2 py-1 rounded-md text-[#031A10]/70 border border-white/40">
                          {note.subject || "General"}
                        </span>
                      </div>

                      {/* Attachment Indicator */}
                      <div className="hidden md:flex w-32 items-center justify-center">
                        {note.file_url ? (
                          <span className="text-xs font-bold text-[#031A10]/70 bg-[#031A10]/5 px-2 py-1 rounded-md">
                            Included
                          </span>
                        ) : (
                          <span className="text-gray-400 text-xs">-</span>
                        )}
                      </div>

                      {/* Date */}
                      <div className="w-full md:w-32 flex items-center md:justify-end text-xs font-medium text-gray-500 border-t md:border-t-0 border-black/5 pt-3 md:pt-0">
                        {new Date(note.created_at).toLocaleDateString([], {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </div>
                    </div>
                  ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-24 opacity-50 bg-white/30 rounded-[24px] border border-white/20 backdrop-blur-md">
                <BookOpen className="w-16 h-16 text-[#031A10]/40 mb-4" />
                <p className="text-xl font-bold text-[#031A10]/70 mb-2">
                  No materials found
                </p>
                <p className="text-gray-500 text-sm">
                  {selectedFolder === "All"
                    ? "Create your first note to share with your class."
                    : `No notes in the ${selectedFolder} folder.`}
                </p>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Note Creation Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="bg-white rounded-[32px] shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto relative"
            >
              <div className="p-8">
                <div className="flex items-center justify-between mb-8">
                  <h2 className="text-2xl font-bold text-[#031A10] font-manrope">
                    Create New Note
                  </h2>
                  <button
                    onClick={closeModal}
                    className="p-2 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <form onSubmit={handleSave}>
                  <div className="mb-6">
                    <label className="block text-sm font-bold text-[#031A10] mb-2 uppercase tracking-wider">
                      Note Title
                    </label>
                    <input
                      type="text"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="e.g. Week 1 Physics Notes"
                      autoFocus
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl px-5 py-4 text-[#031A10] font-medium outline-none focus:border-[#031A10] transition-colors"
                    />
                  </div>

                  <div className="mb-6">
                    <label className="block text-sm font-bold text-[#031A10] mb-2 uppercase tracking-wider">
                      Subject Folder
                    </label>
                    <input
                      type="text"
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      placeholder="e.g. Physics, Math, General"
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl px-5 py-4 text-[#031A10] font-medium outline-none focus:border-[#031A10] transition-colors"
                    />
                  </div>

                  <div className="mb-6">
                    <label className="block text-sm font-bold text-[#031A10] mb-2 uppercase tracking-wider">
                      Attachment (Optional)
                    </label>
                    <div className="w-full bg-gray-50 border border-gray-200 border-dashed rounded-xl px-5 py-6 text-center hover:bg-gray-100 transition-colors cursor-pointer relative">
                      <input
                        type="file"
                        onChange={(e) => setFile(e.target.files?.[0] || null)}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        accept=".pdf,.doc,.docx,.txt"
                      />
                      {file ? (
                        <div className="flex flex-col items-center">
                          <div className="p-2 bg-[#D0FFA2]/30 text-[#031A10] rounded-full mb-2">
                            <Paperclip className="w-5 h-5" />
                          </div>
                          <p className="text-[#031A10] font-medium">
                            {file.name}
                          </p>
                          <p className="text-[#031A10]/80 font-bold text-sm mt-2">
                            ✅ Selected and ready to upload!
                          </p>
                          <p className="text-gray-500 text-xs mt-1">
                            Click anywhere here to change file, or click
                            &apos;Save Note&apos; to upload.
                          </p>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center">
                          <div className="p-2 bg-gray-200 text-gray-600 rounded-full mb-2">
                            <Plus className="w-5 h-5" />
                          </div>
                          <p className="text-gray-600 font-medium">
                            Upload PDF or Document
                          </p>
                          <p className="text-gray-400 text-xs mt-1">
                            Max size 50MB
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="mb-8">
                    <label className="block text-sm font-bold text-[#031A10] mb-2 uppercase tracking-wider">
                      Content (Optional if attachment)
                    </label>
                    <textarea
                      value={content}
                      onChange={(e) => setContent(e.target.value)}
                      placeholder="Start typing your notes here..."
                      rows={4}
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl px-5 py-4 text-[#031A10] outline-none focus:border-[#031A10] transition-colors resize-none"
                    />
                  </div>

                  <div className="flex justify-end gap-3">
                    <button
                      type="button"
                      onClick={closeModal}
                      className="px-6 py-3 rounded-full font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={
                        !title.trim() || (!content.trim() && !file) || isSaving
                      }
                      className="px-8 py-3 rounded-full font-bold text-[#031A10] transition-colors flex items-center gap-2 disabled:opacity-50"
                      style={{ background: "#D0FFA2" }}
                    >
                      {isSaving ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          {file ? "Uploading..." : "Saving..."}
                        </>
                      ) : (
                        <>
                          <Save className="w-4 h-4" />
                          Save Note
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Folder Creation Modal */}
      <AnimatePresence>
        {isFolderModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="bg-white rounded-[32px] shadow-2xl w-full max-w-md relative p-8"
            >
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-2xl font-bold text-[#031A10] font-manrope">
                  New Folder
                </h2>
                <button
                  onClick={() => setIsFolderModalOpen(false)}
                  className="p-2 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (newFolderName.trim()) {
                    setCustomFolders((prev) => [...prev, newFolderName.trim()]);
                    setSelectedFolder(newFolderName.trim());
                    setIsFolderModalOpen(false);
                    setNewFolderName("");
                  }
                }}
              >
                <div className="mb-6">
                  <label className="block text-sm font-bold text-[#031A10] mb-2 uppercase tracking-wider">
                    Folder Name
                  </label>
                  <input
                    type="text"
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    placeholder="e.g. History, Math"
                    autoFocus
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-5 py-4 text-[#031A10] font-medium outline-none focus:border-[#031A10] transition-colors"
                  />
                </div>

                <div className="flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setIsFolderModalOpen(false)}
                    className="px-6 py-3 rounded-full font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={!newFolderName.trim()}
                    className="px-8 py-3 rounded-full font-bold text-[#031A10] transition-colors disabled:opacity-50"
                    style={{ background: "#D0FFA2" }}
                  >
                    Create
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Note View Modal */}
      <AnimatePresence>
        {selectedNote && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="bg-[#1A1C19] border border-white/10 rounded-[32px] shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden relative flex flex-col"
            >
              <div className="p-8 border-b border-white/10 flex items-center justify-between bg-[#1A1C19]/90 backdrop-blur sticky top-0">
                <h2 className="text-2xl font-bold text-white font-manrope">
                  {selectedNote.title}
                </h2>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleDeleteNote(selectedNote.id)}
                    disabled={isDeleting}
                    className="p-2 rounded-full bg-red-500/10 hover:bg-red-500/20 text-red-400 hover:text-red-300 transition-colors disabled:opacity-50"
                    title="Delete Note"
                  >
                    {isDeleting ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <Trash2 className="w-5 h-5" />
                    )}
                  </button>
                  <button
                    onClick={() => setSelectedNote(null)}
                    className="p-2 rounded-full bg-white/5 hover:bg-white/10 text-white/60 hover:text-white transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              <div className="p-8 overflow-y-auto custom-scrollbar flex-1">
                <p className="text-white/80 whitespace-pre-wrap leading-relaxed">
                  {selectedNote.content}
                </p>

                {selectedNote.file_url && (
                  <div className="mt-8 flex flex-col gap-4">
                    <div className="p-4 bg-white/5 border border-white/10 rounded-xl flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-white/10 rounded-lg text-white">
                          <Paperclip className="w-5 h-5" />
                        </div>
                        <div>
                          <p className="text-sm font-bold text-white">
                            Attached Document
                          </p>
                          <p className="text-xs text-white/50">
                            Stored in Supabase
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <a
                          href={selectedNote.file_url}
                          target="_blank"
                          rel="noreferrer"
                          className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white font-medium rounded-lg transition-colors flex items-center gap-2 text-sm"
                        >
                          <BookOpen className="w-4 h-4" />
                          View
                        </a>
                        <a
                          href={`${selectedNote.file_url}?download=`}
                          className="px-4 py-2 bg-[#D0FFA2] hover:bg-[#b5f27c] text-[#031A10] font-bold rounded-lg transition-colors flex items-center gap-2 text-sm"
                        >
                          <Download className="w-4 h-4" />
                          Download
                        </a>
                      </div>
                    </div>
                  </div>
                )}

                <div className="mt-8 pt-6 border-t border-white/10 flex items-center gap-2 text-xs text-white/40">
                  <BookOpen className="w-3 h-3" />
                  Last updated{" "}
                  {new Date(selectedNote.created_at).toLocaleDateString([], {
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
