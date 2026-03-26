"use client";

import { useCallback, useState } from "react";

export interface UploadedImage {
  /** Base64 data URL for local preview */
  dataUrl: string;
  /** Error message if upload failed */
  error?: string;
  /** Client-generated unique ID */
  id: string;
  /** Original file name */
  name: string;
  /** File size in bytes */
  size: number;
  /** Upload status */
  status: "pending" | "uploading" | "uploaded" | "error";
  /** MIME type (image/png, image/jpeg, etc.) */
  type: string;
  /** Uploaded URL after server upload (null while pending) */
  url: string | null;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ACCEPTED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
]);

function generateImageId(): string {
  return `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function validateFiles(files: File[]): { errors: string[]; valid: File[] } {
  const valid: File[] = [];
  const errors: string[] = [];
  for (const file of files) {
    if (!ACCEPTED_TYPES.has(file.type)) {
      errors.push(`${file.name}: unsupported image type`);
    } else if (file.size > MAX_FILE_SIZE) {
      errors.push(`${file.name}: exceeds 10 MB limit`);
    } else {
      valid.push(file);
    }
  }
  return { valid, errors };
}

async function buildImageEntries(
  files: File[],
  hasUploadUrl: boolean
): Promise<UploadedImage[]> {
  const entries: UploadedImage[] = [];
  for (const file of files) {
    const dataUrl = await readFileAsDataUrl(file);
    entries.push({
      id: generateImageId(),
      name: file.name,
      type: file.type,
      size: file.size,
      dataUrl,
      url: null,
      status: hasUploadUrl ? "pending" : "uploaded",
    });
  }
  return entries;
}

async function uploadSingleImage(
  img: UploadedImage,
  file: File,
  url: string,
  uploadHeaders: Record<string, string>,
  setter: React.Dispatch<React.SetStateAction<UploadedImage[]>>
): Promise<void> {
  setter((prev) =>
    prev.map((i) =>
      i.id === img.id ? { ...i, status: "uploading" as const } : i
    )
  );
  try {
    const formData = new FormData();
    formData.append("file", file);
    const response = await fetch(url, {
      method: "POST",
      headers: uploadHeaders,
      body: formData,
    });
    if (!response.ok) {
      throw new Error(`Upload failed: ${response.status}`);
    }
    const result = (await response.json()) as { url: string };
    setter((prev) =>
      prev.map((i) =>
        i.id === img.id
          ? { ...i, status: "uploaded" as const, url: result.url }
          : i
      )
    );
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Upload failed";
    setter((prev) =>
      prev.map((i) =>
        i.id === img.id
          ? { ...i, status: "error" as const, error: errorMsg }
          : i
      )
    );
  }
}

interface UseImageUploadOptions {
  /** Additional headers for upload requests */
  headers?: Record<string, string>;
  /** Maximum number of images allowed */
  maxImages?: number;
  /** API endpoint for uploading images */
  uploadUrl?: string;
}

export function useImageUpload(options: UseImageUploadOptions = {}) {
  const { maxImages = 5, uploadUrl, headers } = options;
  const [images, setImages] = useState<UploadedImage[]>([]);

  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      const { valid: validFiles, errors } = validateFiles(Array.from(files));

      const slotsAvailable = maxImages - images.length;
      const toAdd = validFiles.slice(0, Math.max(0, slotsAvailable));

      if (toAdd.length < validFiles.length) {
        errors.push(`Only ${maxImages} images allowed; some were skipped.`);
      }

      const newImages = await buildImageEntries(toAdd, Boolean(uploadUrl));
      setImages((prev) => [...prev, ...newImages]);

      if (uploadUrl) {
        for (const img of newImages) {
          const matchingFile = toAdd.find((f) => f.name === img.name);
          if (matchingFile) {
            await uploadSingleImage(
              img,
              matchingFile,
              uploadUrl,
              headers ?? {},
              setImages
            );
          }
        }
      }

      return { added: newImages.length, errors };
    },
    [images.length, maxImages, uploadUrl, headers]
  );

  const removeImage = useCallback((imageId: string) => {
    setImages((prev) => prev.filter((i) => i.id !== imageId));
  }, []);

  const clearImages = useCallback(() => {
    setImages([]);
  }, []);

  /**
   * Handle paste events to extract images from clipboard.
   * Attach to a container element's onPaste event.
   */
  const handlePaste = useCallback(
    async (event: React.ClipboardEvent | ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (!items) {
        return;
      }

      const imageFiles: File[] = [];
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            imageFiles.push(file);
          }
        }
      }

      if (imageFiles.length > 0) {
        event.preventDefault();
        await addFiles(imageFiles);
      }
    },
    [addFiles]
  );

  /**
   * Handle drag-and-drop of image files.
   * Attach to a container element's onDrop event.
   */
  const handleDrop = useCallback(
    async (event: React.DragEvent | DragEvent) => {
      event.preventDefault();
      const files = event.dataTransfer?.files;
      if (files && files.length > 0) {
        await addFiles(files);
      }
    },
    [addFiles]
  );

  const handleDragOver = useCallback((event: React.DragEvent | DragEvent) => {
    event.preventDefault();
  }, []);

  return {
    images,
    addFiles,
    removeImage,
    clearImages,
    handlePaste,
    handleDrop,
    handleDragOver,
    hasImages: images.length > 0,
    isUploading: images.some((i) => i.status === "uploading"),
  };
}
