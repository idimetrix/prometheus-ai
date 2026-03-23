import type { EmailTemplate } from "./service";

function createTemplate(subject: string, body: string): EmailTemplate {
  return {
    subject,
    html: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #1a1a1a; }
  .header { background: linear-gradient(135deg, #6366f1, #8b5cf6); padding: 30px; border-radius: 12px 12px 0 0; text-align: center; }
  .header h1 { color: white; margin: 0; font-size: 24px; }
  .content { background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-radius: 0 0 12px 12px; }
  .btn { display: inline-block; background: #6366f1; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; }
  .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; }
</style></head>
<body>
  <div class="header"><h1>Prometheus</h1></div>
  <div class="content">${body}</div>
  <div class="footer">
    <p>Prometheus -- AI-Powered Engineering Platform</p>
    <p>You received this because you're a Prometheus user.</p>
  </div>
</body>
</html>`,
    text: body.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " "),
  };
}

export const TEMPLATES = {
  welcome: (name: string) =>
    createTemplate(
      "Welcome to Prometheus!",
      `<h2>Welcome, ${name}!</h2>
      <p>You've just joined the most powerful AI engineering platform. Here's how to get started:</p>
      <ol>
        <li><strong>Create your first project</strong> -- Connect a GitHub repo</li>
        <li><strong>Run your first task</strong> -- Try "Add a user profile page"</li>
        <li><strong>Watch the magic</strong> -- 12 AI agents work together for you</li>
      </ol>
      <p><a href="https://prometheus.dev/dashboard" class="btn">Go to Dashboard</a></p>`
    ),

  sessionComplete: (sessionId: string, summary: string) =>
    createTemplate(
      "Session Complete -- Prometheus",
      `<h2>Your session is complete</h2>
      <p>Session <code>${sessionId}</code> has finished.</p>
      <p>${summary}</p>
      <p><a href="https://prometheus.dev/sessions/${sessionId}" class="btn">View Results</a></p>`
    ),

  lowCredits: (remaining: number, total: number) =>
    createTemplate(
      "Low Credits Warning -- Prometheus",
      `<h2>Credits Running Low</h2>
      <p>You have <strong>${remaining}</strong> credits remaining out of ${total}.</p>
      <p>Upgrade your plan or purchase additional credits to continue using Prometheus.</p>
      <p><a href="https://prometheus.dev/settings/billing" class="btn">Manage Billing</a></p>`
    ),

  weeklyDigest: (stats: {
    sessions: number;
    credits: number;
    filesChanged: number;
  }) =>
    createTemplate(
      "Your Weekly Digest -- Prometheus",
      `<h2>Weekly Activity Summary</h2>
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;"><strong>Sessions</strong></td><td style="padding:8px;border-bottom:1px solid #e5e7eb;">${stats.sessions}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;"><strong>Credits Used</strong></td><td style="padding:8px;border-bottom:1px solid #e5e7eb;">${stats.credits}</td></tr>
        <tr><td style="padding:8px;"><strong>Files Changed</strong></td><td style="padding:8px;">${stats.filesChanged}</td></tr>
      </table>
      <p><a href="https://prometheus.dev/analytics" class="btn">View Analytics</a></p>`
    ),
};
