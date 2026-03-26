"use client";

import { useCallback, useRef, useState } from "react";
import { logger } from "@/lib/logger";
import { trpc } from "@/lib/trpc";

interface ImageUploadProps {
  onError?: (error: string) => void;
  onUploadComplete: (result: { id: string; url: string }) => void;
}

const ALLOWED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
]);
const MAX_SIZE = 10 * 1024 * 1024; // 10MB

function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes}B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)}KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function ImageUpload({ onUploadComplete, onError }: ImageUploadProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadImage = trpc.uploads.uploadImage.useMutation();

  const processFile = useCallback(
    async (file: File) => {
      // Validate type
      if (!ALLOWED_TYPES.has(file.type)) {
        const msg = `Unsupported file type: ${file.type}. Allowed: PNG, JPG, WEBP, SVG`;
        onError?.(msg);
        return;
      }

      // Validate size
      if (file.size > MAX_SIZE) {
        const msg = `File too large: ${formatFileSize(file.size)}. Maximum: 10MB`;
        onError?.(msg);
        return;
      }

      // Generate preview
      const reader = new FileReader();
      reader.onload = () => {
        setPreview(reader.result as string);
      };
      reader.readAsDataURL(file);

      setFileName(file.name);
      setUploadProgress(0);

      try {
        // Convert to base64
        const buffer = await file.arrayBuffer();
        const base64 = btoa(
          new Uint8Array(buffer).reduce(
            (data, byte) => data + String.fromCharCode(byte),
            ""
          )
        );

        setUploadProgress(50);

        const result = await uploadImage.mutateAsync({
          base64,
          mimeType: file.type as
            | "image/png"
            | "image/jpeg"
            | "image/webp"
            | "image/svg+xml",
          filename: file.name,
        });

        setUploadProgress(100);
        onUploadComplete({ id: result.id, url: result.url });
      } catch (err) {
        logger.error("Image upload failed:", err);
        onError?.("Failed to upload image. Please try again.");
        setPreview(null);
        setFileName(null);
      } finally {
        // Reset progress after a brief delay
        setTimeout(() => setUploadProgress(null), 1000);
      }
    },
    [onUploadComplete, onError, uploadImage]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);

      const file = e.dataTransfer.files[0];
      if (file) {
        processFile(file);
      }
    },
    [processFile]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        processFile(file);
      }
    },
    [processFile]
  );

  // Handle paste from clipboard
  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData.items;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) {
            processFile(file);
          }
          return;
        }
      }
    },
    [processFile]
  );

  function handleClearPreview() {
    setPreview(null);
    setFileName(null);
    setUploadProgress(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-2" onPaste={handlePaste}>
      {/* Preview thumbnail */}
      {preview && (
        <div className="relative inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800/50 p-2">
          {/* biome-ignore lint/performance/noImgElement: preview thumbnail */}
          <img
            alt={fileName ?? "Uploaded image"}
            className="h-16 w-16 rounded object-cover"
            height={64}
            src={preview}
            width={64}
          />
          <div className="flex flex-col gap-0.5">
            <span className="max-w-[200px] truncate text-xs text-zinc-300">
              {fileName}
            </span>
            {uploadProgress !== null && (
              <div className="h-1 w-32 overflow-hidden rounded-full bg-zinc-700">
                <div
                  className="h-full rounded-full bg-pink-500 transition-all duration-300"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            )}
            {uploadProgress === 100 && (
              <span className="text-[10px] text-green-400">Uploaded</span>
            )}
          </div>
          <button
            aria-label="Remove image"
            className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-zinc-700 text-zinc-400 transition-colors hover:bg-zinc-600 hover:text-zinc-200"
            onClick={handleClearPreview}
            type="button"
          >
            <svg
              aria-hidden="true"
              className="h-3 w-3"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path
                d="M6 18 18 6M6 6l12 12"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      )}

      {/* Drop zone */}
      {!preview && (
        <button
          className={`flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed p-4 transition-colors ${
            isDragOver
              ? "border-pink-500 bg-pink-500/5"
              : "border-zinc-700 hover:border-zinc-600"
          }`}
          onClick={() => fileInputRef.current?.click()}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          type="button"
        >
          <svg
            aria-hidden="true"
            className={`h-6 w-6 ${isDragOver ? "text-pink-400" : "text-zinc-500"}`}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            viewBox="0 0 24 24"
          >
            <path
              d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3 16.5V18a2.25 2.25 0 0 0 2.25 2.25h13.5A2.25 2.25 0 0 0 21 18V6a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 6v10.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <p className="text-xs text-zinc-400">
            {isDragOver
              ? "Drop image here"
              : "Drop image, paste from clipboard, or click to browse"}
          </p>
          <p className="text-[10px] text-zinc-600">
            PNG, JPG, WEBP, SVG up to 10MB
          </p>
        </button>
      )}

      <input
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        className="hidden"
        onChange={handleFileSelect}
        ref={fileInputRef}
        type="file"
      />
    </div>
  );
}
