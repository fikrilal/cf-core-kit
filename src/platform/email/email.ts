import type { AppConfig } from "../config/config";

export type SendEmailInput = Readonly<{
  to: string;
  subject: string;
  text: string;
  html?: string;
}>;

export type SendEmailResult = Readonly<{ id: string }>;

export type EmailSendErrorCode = "not_configured" | "provider_error";

export class EmailSendError extends Error {
  readonly code: EmailSendErrorCode;

  constructor(code: EmailSendErrorCode, message: string) {
    super(message);

    this.name = "EmailSendError";
    this.code = code;
  }
}

export type EmailPort = Readonly<{
  isEnabled: () => boolean;
  send: (input: SendEmailInput) => Promise<SendEmailResult>;
}>;

const RESEND_ENDPOINT = "https://api.resend.com/emails";

function readId(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return undefined;
  }

  const record: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) record[key] = value;

  return typeof record.id === "string" && record.id !== ""
    ? record.id
    : undefined;
}

export function disabledEmailPort(): EmailPort {
  return {
    isEnabled: () => false,
    send: () =>
      Promise.reject(
        new EmailSendError(
          "not_configured",
          "Email is not configured (set RESEND_API_KEY and EMAIL_FROM)",
        ),
      ),
  };
}

export function createEmailPort(config: AppConfig): EmailPort {
  const apiKey = config.resendApiKey;
  const from = config.emailFrom;

  if (apiKey === undefined || from === undefined) {
    return disabledEmailPort();
  }

  return {
    isEnabled: () => true,
    send: async (input) => {
      if (input.subject.trim() === "") {
        throw new EmailSendError("provider_error", "Email subject is required");
      }

      const response = await fetch(RESEND_ENDPOINT, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [input.to],
          subject: input.subject,
          text: input.text,
          ...(input.html === undefined ? {} : { html: input.html }),
          ...(config.emailReplyTo === undefined
            ? {}
            : { reply_to: config.emailReplyTo }),
        }),
      });

      if (!response.ok) {
        throw new EmailSendError(
          "provider_error",
          `Email provider responded with status ${String(response.status)}`,
        );
      }

      const id = readId(await response.json());

      if (id === undefined) {
        throw new EmailSendError(
          "provider_error",
          "Email provider response is missing an id",
        );
      }

      return { id };
    },
  };
}
