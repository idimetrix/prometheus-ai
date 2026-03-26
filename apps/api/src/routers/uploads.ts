import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

const logger = createLogger("uploads-router");

const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT ?? "http://localhost:9000";
const MINIO_BUCKET = process.env.MINIO_UPLOADS_BUCKET ?? "uploads";
const MINIO_ACCESS_KEY = process.env.MINIO_ACCESS_KEY ?? "minioadmin";
const MINIO_SECRET_KEY = process.env.MINIO_SECRET_KEY ?? "minioadmin";

const ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
]);

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

export const uploadsRouter = router({
  /**
   * Upload an image (base64 encoded).
   * Stores in MinIO bucket and returns the public URL.
   */
  uploadImage: protectedProcedure
    .input(
      z.object({
        /** Base64-encoded image data (without data URI prefix) */
        base64: z.string().min(1),
        /** MIME type of the image */
        mimeType: z.enum([
          "image/png",
          "image/jpeg",
          "image/webp",
          "image/svg+xml",
        ]),
        /** Optional filename */
        filename: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { base64, mimeType, filename } = input;

      if (!ALLOWED_MIME_TYPES.has(mimeType)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Unsupported file type: ${mimeType}. Allowed: PNG, JPG, WEBP, SVG`,
        });
      }

      // Decode and validate size
      const buffer = Buffer.from(base64, "base64");
      if (buffer.length > MAX_FILE_SIZE) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `File too large: ${(buffer.length / 1024 / 1024).toFixed(1)}MB. Maximum: 10MB`,
        });
      }

      const id = generateId();
      const ext = MIME_TO_EXT[mimeType] ?? "png";
      const objectKey = `${ctx.orgId}/${id}.${ext}`;

      try {
        // Upload to MinIO via S3-compatible PUT
        const url = `${MINIO_ENDPOINT}/${MINIO_BUCKET}/${objectKey}`;
        const response = await fetch(url, {
          method: "PUT",
          headers: {
            "Content-Type": mimeType,
            "Content-Length": String(buffer.length),
            Authorization: `Basic ${Buffer.from(`${MINIO_ACCESS_KEY}:${MINIO_SECRET_KEY}`).toString("base64")}`,
          },
          body: buffer,
        });

        if (!response.ok) {
          logger.error(
            {
              status: response.status,
              objectKey,
            },
            "MinIO upload failed"
          );
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to upload image to storage",
          });
        }

        const publicUrl = `${MINIO_ENDPOINT}/${MINIO_BUCKET}/${objectKey}`;

        logger.info(
          {
            id,
            objectKey,
            size: buffer.length,
            mimeType,
            orgId: ctx.orgId,
          },
          "Image uploaded"
        );

        return {
          id,
          url: publicUrl,
          filename: filename ?? `${id}.${ext}`,
          mimeType,
          size: buffer.length,
        };
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }
        logger.error({ error, objectKey }, "Image upload error");
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to upload image",
        });
      }
    }),

  /**
   * Get an image by ID. Returns a signed URL.
   */
  getImage: protectedProcedure
    .input(
      z.object({
        id: z.string().min(1),
        extension: z
          .enum(["png", "jpg", "webp", "svg"])
          .optional()
          .default("png"),
      })
    )
    .query(async ({ input, ctx }) => {
      const objectKey = `${ctx.orgId}/${input.id}.${input.extension}`;
      const url = `${MINIO_ENDPOINT}/${MINIO_BUCKET}/${objectKey}`;

      try {
        // Verify the object exists with a HEAD request
        const response = await fetch(url, {
          method: "HEAD",
          headers: {
            Authorization: `Basic ${Buffer.from(`${MINIO_ACCESS_KEY}:${MINIO_SECRET_KEY}`).toString("base64")}`,
          },
        });

        if (!response.ok) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Image not found",
          });
        }

        return {
          id: input.id,
          url,
          mimeType:
            response.headers.get("content-type") ?? "application/octet-stream",
          size: Number(response.headers.get("content-length") ?? 0),
        };
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }
        logger.error({ error, objectKey }, "Get image error");
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to retrieve image",
        });
      }
    }),
});
