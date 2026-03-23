/**
 * SOPS secrets decryption utility.
 *
 * Wraps the `sops` CLI to decrypt SOPS-encrypted values and files at runtime.
 * Requires `sops` to be installed and configured with appropriate key access
 * (AWS KMS, GCP KMS, Azure Key Vault, age, or PGP).
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/**
 * Decrypt a single SOPS-encrypted value.
 *
 * Writes the encrypted value to a temp buffer and pipes it through
 * `sops --decrypt /dev/stdin`.
 */
export function decryptSopsValue(encryptedValue: string): string {
  try {
    const result = execFileSync("sops", ["--decrypt", "/dev/stdin"], {
      input: encryptedValue,
      encoding: "utf-8",
      timeout: 30_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return result.trim();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to decrypt SOPS value: ${msg}`);
  }
}

/**
 * Load and decrypt an entire SOPS-encrypted file.
 *
 * Calls `sops --decrypt <filePath>` and parses the result as JSON,
 * returning a flat key-value record of decrypted secrets.
 */
export function loadSopsFile(filePath: string): Record<string, string> {
  // Verify the file exists before attempting decryption
  try {
    readFileSync(filePath);
  } catch {
    throw new Error(`SOPS file not found: ${filePath}`);
  }

  try {
    const result = execFileSync("sops", ["--decrypt", filePath], {
      encoding: "utf-8",
      timeout: 30_000,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const parsed: unknown = JSON.parse(result);

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new Error("SOPS file did not contain a JSON object");
    }

    // Flatten to string values only
    const record: Record<string, string> = {};
    for (const [key, value] of Object.entries(
      parsed as Record<string, unknown>
    )) {
      record[key] = String(value);
    }

    return record;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(
        `Failed to parse decrypted SOPS file as JSON: ${error.message}`
      );
    }
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to decrypt SOPS file: ${msg}`);
  }
}
