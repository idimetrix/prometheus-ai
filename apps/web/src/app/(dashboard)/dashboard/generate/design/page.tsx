"use client";

import { Button } from "@prometheus/ui";
import { ImagePlus, Loader2, Send, Sparkles, Upload, X } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

interface ChatMessage {
  code?: string;
  content: string;
  id: string;
  role: "user" | "assistant";
}

export default function DesignIterationPage() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [uploadedImageName, setUploadedImageName] = useState<string | null>(
    null
  );
  const [isDragging, setIsDragging] = useState(false);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [currentCode, setCurrentCode] = useState("");
  const [showCode, setShowCode] = useState(false);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadMutation = trpc.design.upload.useMutation();
  const generateMutation = trpc.design.generate.useMutation();
  const iterateMutation = trpc.design.iterate.useMutation();

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const handleImageFile = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Please upload an image file (PNG, JPG, etc.)");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Image must be under 10MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result;
      if (typeof result === "string") {
        setUploadedImage(result);
        setUploadedImageName(file.name);
      }
    };
    reader.readAsDataURL(file);
  }, []);

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!isDragging) {
        setIsDragging(true);
      }
    },
    [isDragging]
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) {
        handleImageFile(file);
      }
    },
    [handleImageFile]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        handleImageFile(file);
      }
      e.target.value = "";
    },
    [handleImageFile]
  );

  const clearUploadedImage = useCallback(() => {
    setUploadedImage(null);
    setUploadedImageName(null);
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!uploadedImage || isGenerating) {
      return;
    }

    setIsGenerating(true);
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: `Generate component from design: ${uploadedImageName ?? "image"}${input.trim() ? ` - ${input.trim()}` : ""}`,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");

    try {
      // Create the upload record
      const { upload } = await uploadMutation.mutateAsync({
        storageUrl: uploadedImage,
        originalFilename: uploadedImageName ?? undefined,
        mimeType: "image/png",
      });

      // Create a generation job
      const { job } = await generateMutation.mutateAsync({
        designUploadId: upload.id,
        framework: "react",
      });

      setCurrentJobId(job.id);

      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content:
          "Design-to-code job created. The component is being generated. You can now provide feedback to iterate on the design.",
        code: job.generatedCode ?? undefined,
      };
      setMessages((prev) => [...prev, assistantMsg]);
      if (job.generatedCode) {
        setCurrentCode(job.generatedCode);
      }
      scrollToBottom();
    } catch {
      toast.error("Failed to start design generation");
      const errorMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "Failed to start generation. Please try again.",
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsGenerating(false);
      inputRef.current?.focus();
    }
  }, [
    uploadedImage,
    uploadedImageName,
    isGenerating,
    input,
    uploadMutation,
    generateMutation,
    scrollToBottom,
  ]);

  const handleIterate = useCallback(async () => {
    const feedback = input.trim();
    if (!(feedback && currentJobId) || isGenerating) {
      return;
    }

    setIsGenerating(true);
    setInput("");

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: feedback,
    };
    setMessages((prev) => [...prev, userMsg]);

    try {
      const { code } = await iterateMutation.mutateAsync({
        jobId: currentJobId,
        userFeedback: feedback,
      });

      setCurrentCode(code);

      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "Code updated based on your feedback.",
        code,
      };
      setMessages((prev) => [...prev, assistantMsg]);
      scrollToBottom();
    } catch {
      toast.error("Failed to iterate on design");
      const errorMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "Iteration failed. Please try again.",
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsGenerating(false);
      inputRef.current?.focus();
    }
  }, [input, currentJobId, isGenerating, iterateMutation, scrollToBottom]);

  const handleSend = useCallback(() => {
    if (currentJobId) {
      handleIterate();
    } else {
      handleGenerate();
    }
  }, [currentJobId, handleIterate, handleGenerate]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col gap-4 lg:flex-row">
      {/* Left panel: Upload + Chat */}
      <div className="flex w-full flex-col rounded-xl border bg-card lg:w-[420px] lg:min-w-[380px]">
        {/* Header */}
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="font-medium text-sm">Design Iteration</span>
        </div>

        {/* Image Upload Zone */}
        <div
          className={`border-b px-4 py-3 ${isDragging ? "bg-primary/10" : ""}`}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          <input
            accept="image/*"
            className="hidden"
            onChange={handleFileSelect}
            ref={fileInputRef}
            type="file"
          />

          {uploadedImage ? (
            <div className="flex items-start gap-3">
              <div className="relative">
                {/* biome-ignore lint/performance/noImgElement: preview thumbnail for base64 data URL */}
                {/* biome-ignore lint/correctness/useImageSize: thumbnail dimensions set via CSS */}
                <img
                  alt="Uploaded design"
                  className="h-20 w-32 rounded-md border border-zinc-700 object-cover"
                  src={uploadedImage}
                />
                <button
                  aria-label="Remove uploaded image"
                  className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-zinc-700 text-zinc-300 transition-colors hover:bg-red-500 hover:text-white"
                  onClick={clearUploadedImage}
                  type="button"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
              <div className="flex flex-1 flex-col gap-1.5">
                <span className="max-w-[180px] truncate text-foreground text-xs">
                  {uploadedImageName}
                </span>
                {!currentJobId && (
                  <Button
                    disabled={isGenerating}
                    onClick={handleGenerate}
                    size="sm"
                  >
                    <Sparkles className="mr-1 h-3 w-3" />
                    Generate from design
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <button
              className={`flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 text-muted-foreground text-xs transition-colors ${
                isDragging
                  ? "border-primary text-primary"
                  : "border-zinc-700 hover:border-zinc-500 hover:text-foreground"
              }`}
              onClick={() => fileInputRef.current?.click()}
              type="button"
            >
              {isDragging ? (
                <>
                  <Upload className="h-5 w-5" />
                  Drop image here
                </>
              ) : (
                <>
                  <ImagePlus className="h-5 w-5" />
                  Drag and drop a screenshot or mockup
                </>
              )}
            </button>
          )}
        </div>

        {/* Chat Messages */}
        <div className="flex-1 overflow-auto p-4">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <Sparkles className="h-6 w-6 text-primary" />
              </div>
              <div>
                <p className="font-medium text-foreground text-sm">
                  Upload a design to get started
                </p>
                <p className="mt-1 text-muted-foreground text-xs">
                  Upload an image, generate code, then iterate with chat
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {messages.map((msg) => (
                <div
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                  key={msg.id}
                >
                  <div
                    className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "border bg-card text-foreground"
                    }`}
                  >
                    <p>{msg.content}</p>
                    {msg.code && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs opacity-70">
                          View code diff
                        </summary>
                        <pre className="mt-1 max-h-40 overflow-auto rounded bg-zinc-900 p-2 text-[11px] leading-relaxed">
                          <code>{msg.code.slice(-200)}</code>
                        </pre>
                      </details>
                    )}
                  </div>
                </div>
              ))}
              {isGenerating && (
                <div className="flex justify-start">
                  <div className="rounded-xl border bg-card px-3 py-2">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Refinement chips */}
        {currentJobId && !isGenerating && (
          <div className="flex flex-wrap gap-1.5 border-t px-4 py-2">
            {[
              "Make it more responsive",
              "Adjust spacing",
              "Change color scheme",
              "Add animations",
            ].map((chip) => (
              <button
                className="rounded-full border px-2.5 py-1 text-muted-foreground text-xs transition-colors hover:border-primary hover:text-primary"
                key={chip}
                onClick={() => {
                  setInput(chip);
                }}
                type="button"
              >
                {chip}
              </button>
            ))}
          </div>
        )}

        {/* Input */}
        <div className="border-t p-3">
          <div className="flex items-end gap-2">
            <textarea
              className="flex-1 resize-none rounded-lg border bg-background px-3 py-2.5 text-sm outline-none placeholder:text-muted-foreground focus:border-primary"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                currentJobId
                  ? "Describe changes to the component..."
                  : "Optional description for the design..."
              }
              ref={inputRef}
              rows={2}
              style={{ maxHeight: "120px" }}
              value={input}
            />
            <button
              aria-label="Send message"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              disabled={isGenerating || !(input.trim() || uploadedImage)}
              onClick={handleSend}
              type="button"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Right panel: Preview */}
      <div className="flex min-w-0 flex-1 flex-col rounded-xl border bg-card">
        <div className="flex items-center gap-2 border-b px-4 py-2">
          <span className="font-medium text-sm">Preview</span>
          <button
            className={`rounded border px-2 py-1 text-xs transition-colors ${
              showCode
                ? "border-primary text-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setShowCode(!showCode)}
            type="button"
          >
            Code
          </button>
        </div>

        <div className="flex flex-1 flex-col overflow-hidden">
          {currentCode ? (
            <>
              {/* Preview via iframe with srcdoc */}
              <div
                className={`${showCode ? "h-1/2" : "flex-1"} overflow-hidden p-4`}
              >
                <div className="flex h-full items-center justify-center rounded-lg border bg-zinc-950 p-4">
                  <p className="text-muted-foreground text-sm">
                    Component preview renders here
                  </p>
                </div>
              </div>

              {/* Code pane */}
              {showCode && (
                <div className="h-1/2 border-t">
                  <div className="flex items-center justify-between border-b px-4 py-2">
                    <span className="text-muted-foreground text-xs">
                      component.tsx
                    </span>
                    <button
                      className="text-muted-foreground text-xs transition-colors hover:text-foreground"
                      onClick={() => {
                        navigator.clipboard.writeText(currentCode);
                        toast.success("Code copied");
                      }}
                      type="button"
                    >
                      Copy
                    </button>
                  </div>
                  <pre className="h-[calc(100%-2.5rem)] overflow-auto p-4 text-xs leading-relaxed">
                    <code>{currentCode}</code>
                  </pre>
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
                <Sparkles className="h-8 w-8 text-muted-foreground" />
              </div>
              <p className="text-muted-foreground text-sm">
                Generated component will appear here
              </p>
              <p className="max-w-xs text-muted-foreground text-xs">
                Upload a design image, generate code, then iterate using the
                chat panel
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
