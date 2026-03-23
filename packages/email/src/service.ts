import { createLogger } from "@prometheus/logger";

const logger = createLogger("email");

export interface EmailTemplate {
  html: string;
  subject: string;
  text: string;
}

interface SendEmailParams {
  from?: string;
  html: string;
  subject: string;
  text?: string;
  to: string;
}

/**
 * EmailService wraps Resend for sending transactional emails.
 */
export class EmailService {
  private readonly apiKey: string | undefined;
  private readonly fromAddress: string;

  constructor() {
    this.apiKey = process.env.RESEND_API_KEY;
    this.fromAddress =
      process.env.EMAIL_FROM ?? "Prometheus <noreply@prometheus.dev>";
  }

  async send(
    params: SendEmailParams
  ): Promise<{ id: string; success: boolean }> {
    if (!this.apiKey) {
      logger.warn("RESEND_API_KEY not set, skipping email send");
      return { id: "dry-run", success: true };
    }

    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: params.from ?? this.fromAddress,
          to: params.to,
          subject: params.subject,
          html: params.html,
          text: params.text,
        }),
      });

      if (response.ok) {
        const data = (await response.json()) as { id: string };
        logger.info({ to: params.to, subject: params.subject }, "Email sent");
        return { id: data.id, success: true };
      }

      const error = await response.text();
      logger.error({ status: response.status, error }, "Email send failed");
      return { id: "", success: false };
    } catch (err) {
      logger.error({ err }, "Email service error");
      return { id: "", success: false };
    }
  }

  sendTemplate(
    to: string,
    template: EmailTemplate
  ): Promise<{ id: string; success: boolean }> {
    return this.send({
      to,
      subject: template.subject,
      html: template.html,
      text: template.text,
    });
  }
}
