import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decrypt, encrypt } from "../encryption";

describe("encryption", () => {
  const originalEnv = process.env.ENCRYPTION_KEY;

  beforeAll(() => {
    // Set a test encryption key (32 bytes = 64 hex chars)
    process.env.ENCRYPTION_KEY =
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  });

  afterAll(() => {
    if (originalEnv) {
      process.env.ENCRYPTION_KEY = originalEnv;
    } else {
      process.env.ENCRYPTION_KEY = undefined;
    }
  });

  it("encrypts and decrypts a string", () => {
    const plaintext = "my secret api key";
    const encrypted = encrypt(plaintext);
    expect(encrypted).not.toBe(plaintext);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it("produces different ciphertexts for same plaintext (random IV)", () => {
    const plaintext = "same text";
    const encrypted1 = encrypt(plaintext);
    const encrypted2 = encrypt(plaintext);
    expect(encrypted1).not.toBe(encrypted2);
  });

  it("handles empty string", () => {
    const encrypted = encrypt("");
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe("");
  });

  it("handles unicode text", () => {
    const plaintext = "こんにちは世界 🌍";
    const encrypted = encrypt(plaintext);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it("throws on missing ENCRYPTION_KEY", () => {
    const saved = process.env.ENCRYPTION_KEY;
    Reflect.deleteProperty(process.env, "ENCRYPTION_KEY");
    expect(() => encrypt("test")).toThrow("ENCRYPTION_KEY");
    process.env.ENCRYPTION_KEY = saved;
  });

  it("throws on tampered ciphertext", () => {
    const encrypted = encrypt("test");
    const tampered = `${encrypted.slice(0, -2)}AA`;
    expect(() => decrypt(tampered)).toThrow();
  });
});
