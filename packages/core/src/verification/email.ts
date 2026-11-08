/** Email sending. Resend over HTTPS in production, console output in development. */
export interface EmailSender {
  send(msg: { to: string; subject: string; text: string }): Promise<void>
}

export const DEFAULT_FROM = 'BlueyVatar <aifashiontribute@gmail.com>'

export class ResendSender implements EmailSender {
  constructor(
    private apiKey: string,
    private from: string,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  async send(msg: { to: string; subject: string; text: string }): Promise<void> {
    const res = await this.fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: this.from, to: [msg.to], subject: msg.subject, text: msg.text }),
    })
    // Never include the response body or the address in the error.
    if (!res.ok) throw new Error(`Resend request failed with status ${res.status}`)
  }
}

/** Dev only: prints the message body but never the recipient address. */
export class ConsoleSender implements EmailSender {
  async send(msg: { to: string; subject: string; text: string }): Promise<void> {
    console.log(`[email:dev] ${msg.subject}\n${msg.text}`)
  }
}

export function emailSender(env: Record<string, string | undefined> = process.env): EmailSender {
  return env.RESEND_API_KEY
    ? new ResendSender(env.RESEND_API_KEY, env.EMAIL_FROM || DEFAULT_FROM)
    : new ConsoleSender()
}
