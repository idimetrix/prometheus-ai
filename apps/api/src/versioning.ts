/**
 * API Versioning
 *
 * Simple version tracking and header middleware for API responses.
 * Adds X-API-Version header to all responses for client compatibility checks.
 */

/** Current API version following semver. */
export const API_VERSION = "1.0.0";

/**
 * Adds version headers to the response.
 * Compatible with Hono context objects.
 *
 * @param c - Hono context or any object with a `header(name, value)` method
 */
export function addVersionHeaders(c: {
  header: (name: string, value: string) => void;
}): void {
  c.header("X-API-Version", API_VERSION);
}
