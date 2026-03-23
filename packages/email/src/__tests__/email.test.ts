import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@prometheus/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { EmailService } from "../service";
import { TEMPLATES } from "../templates";

// ---------- TEMPLATES ----------

describe("TEMPLATES", () => {
  describe("welcome", () => {
    it("returns a template with correct subject", () => {
      const tpl = TEMPLATES.welcome("Alice");
      expect(tpl.subject).toBe("Welcome to Prometheus!");
    });

    it("includes the user name in html", () => {
      const tpl = TEMPLATES.welcome("Bob");
      expect(tpl.html).toContain("Bob");
    });

    it("includes the user name in text", () => {
      const tpl = TEMPLATES.welcome("Charlie");
      expect(tpl.text).toContain("Charlie");
    });

    it("html contains proper structure", () => {
      const tpl = TEMPLATES.welcome("Test");
      expect(tpl.html).toContain("<!DOCTYPE html>");
      expect(tpl.html).toContain("Prometheus");
      expect(tpl.html).toContain("dashboard");
    });

    it("text strips HTML tags", () => {
      const tpl = TEMPLATES.welcome("Alice");
      expect(tpl.text).not.toContain("<h2>");
      expect(tpl.text).not.toContain("<p>");
    });
  });

  describe("sessionComplete", () => {
    it("returns a template with correct subject", () => {
      const tpl = TEMPLATES.sessionComplete("sess-123", "Built 3 features");
      expect(tpl.subject).toContain("Session Complete");
    });

    it("includes sessionId and summary in body", () => {
      const tpl = TEMPLATES.sessionComplete("sess-abc", "All done");
      expect(tpl.html).toContain("sess-abc");
      expect(tpl.html).toContain("All done");
    });

    it("includes link to session results", () => {
      const tpl = TEMPLATES.sessionComplete("sess-x", "Summary");
      expect(tpl.html).toContain("sessions/sess-x");
    });
  });

  describe("lowCredits", () => {
    it("returns a template with correct subject", () => {
      const tpl = TEMPLATES.lowCredits(10, 1000);
      expect(tpl.subject).toContain("Low Credits");
    });

    it("includes remaining and total credits", () => {
      const tpl = TEMPLATES.lowCredits(50, 500);
      expect(tpl.html).toContain("50");
      expect(tpl.html).toContain("500");
    });

    it("includes billing link", () => {
      const tpl = TEMPLATES.lowCredits(10, 100);
      expect(tpl.html).toContain("settings/billing");
    });
  });

  describe("weeklyDigest", () => {
    it("returns a template with correct subject", () => {
      const tpl = TEMPLATES.weeklyDigest({
        sessions: 5,
        credits: 200,
        filesChanged: 42,
      });
      expect(tpl.subject).toContain("Weekly Digest");
    });

    it("includes stats in the body", () => {
      const tpl = TEMPLATES.weeklyDigest({
        sessions: 12,
        credits: 350,
        filesChanged: 99,
      });
      expect(tpl.html).toContain("12");
      expect(tpl.html).toContain("350");
      expect(tpl.html).toContain("99");
    });

    it("includes analytics link", () => {
      const tpl = TEMPLATES.weeklyDigest({
        sessions: 1,
        credits: 10,
        filesChanged: 5,
      });
      expect(tpl.html).toContain("analytics");
    });

    it("text version strips HTML from stats table", () => {
      const tpl = TEMPLATES.weeklyDigest({
        sessions: 3,
        credits: 100,
        filesChanged: 20,
      });
      expect(tpl.text).not.toContain("<table");
      expect(tpl.text).not.toContain("<tr>");
    });
  });
});

// ---------- EmailService ----------

describe("EmailService", () => {
  beforeEach(() => {
    process.env.RESEND_API_KEY = undefined;
    process.env.EMAIL_FROM = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env.RESEND_API_KEY = undefined;
    process.env.EMAIL_FROM = undefined;
  });

  it("returns dry-run result when no API key is set", async () => {
    const service = new EmailService();
    const result = await service.send({
      to: "test@example.com",
      subject: "Test",
      html: "<p>Test</p>",
    });
    expect(result.id).toBe("dry-run");
    expect(result.success).toBe(true);
  });

  it("does not call fetch in dry-run mode", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const service = new EmailService();
    await service.send({
      to: "test@example.com",
      subject: "Test",
      html: "<p>Test</p>",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("calls Resend API when API key is set", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ id: "email-123" }), { status: 200 })
      );
    const service = new EmailService();
    const result = await service.send({
      to: "user@example.com",
      subject: "Hello",
      html: "<p>World</p>",
    });
    expect(result.id).toBe("email-123");
    expect(result.success).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer re_test_key",
        }),
      })
    );
  });

  it("returns failure on non-ok response", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Bad Request", { status: 400 })
    );
    const service = new EmailService();
    const result = await service.send({
      to: "user@example.com",
      subject: "Test",
      html: "<p>Test</p>",
    });
    expect(result.success).toBe(false);
    expect(result.id).toBe("");
  });

  it("returns failure on fetch error", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network error"));
    const service = new EmailService();
    const result = await service.send({
      to: "user@example.com",
      subject: "Test",
      html: "<p>Test</p>",
    });
    expect(result.success).toBe(false);
    expect(result.id).toBe("");
  });

  it("uses default from address", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ id: "e-1" }), { status: 200 })
      );
    const service = new EmailService();
    await service.send({
      to: "user@example.com",
      subject: "Test",
      html: "<p>Test</p>",
    });
    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string
    );
    expect(body.from).toContain("Prometheus");
  });

  it("uses custom from when provided in params", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ id: "e-2" }), { status: 200 })
      );
    const service = new EmailService();
    await service.send({
      to: "user@example.com",
      subject: "Test",
      html: "<p>Test</p>",
      from: "custom@example.com",
    });
    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string
    );
    expect(body.from).toBe("custom@example.com");
  });

  it("sendTemplate calls send with template fields", async () => {
    const service = new EmailService();
    const template = TEMPLATES.welcome("Alice");
    const result = await service.sendTemplate("alice@example.com", template);
    // In dry-run mode, should succeed
    expect(result.success).toBe(true);
    expect(result.id).toBe("dry-run");
  });

  it("sendTemplate passes subject, html, and text to send", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ id: "e-tpl" }), { status: 200 })
      );
    const service = new EmailService();
    const template = TEMPLATES.lowCredits(10, 100);
    await service.sendTemplate("user@example.com", template);
    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string
    );
    expect(body.subject).toBe(template.subject);
    expect(body.html).toBe(template.html);
    expect(body.text).toBe(template.text);
  });
});
