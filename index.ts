import { z } from "zod"

export interface SendEmailRequest {
  to: string
  title: string
  body: string
}

const sendEmailResultSchema = z.object({
  id: z.int(),
  messageId: z.string(),
  to: z.string(),
  from: z.string(),
  title: z.string(),
})

export type SendEmailResult = z.infer<typeof sendEmailResultSchema>

export type CmailFetch = (url: URL, init: RequestInit) => Promise<Response>

export interface CmailClientOptions {
  /** Worker origin. Defaults to https://cmail.laroccadev.com. */
  origin?: string
  apiKey: string
  /** Request timeout in milliseconds. Defaults to 30 seconds. */
  timeoutMs?: number
  /** Override fetch for testing or a custom transport. */
  fetch?: CmailFetch
}

export class CmailApiError extends Error {
  readonly status: number

  constructor(status: number, detail: string) {
    super(`Cmail API returned HTTP ${status}: ${detail}`)
    this.name = "CmailApiError"
    this.status = status
  }
}

/** A standalone client for cmail's authenticated outbound email API. */
export class CmailClient {
  private readonly endpoint: URL
  private readonly apiKey: string
  private readonly timeoutMs: number
  private readonly fetch: CmailFetch

  constructor(options: CmailClientOptions) {
    if (!options.apiKey.trim()) {
      throw new Error("apiKey must not be empty")
    }
    const timeoutMs = options.timeoutMs ?? 30_000
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
      throw new Error("timeoutMs must be a positive integer")
    }
    this.endpoint = new URL(
      "/api/email/send",
      options.origin ?? "https://cmail.laroccadev.com"
    )
    this.apiKey = options.apiKey
    this.timeoutMs = timeoutMs
    // Calls the global fetch unbound: Cloudflare Workers throw "Illegal invocation" if its `this` is the client.
    this.fetch =
      options.fetch ?? (async (url, init) => await globalThis.fetch(url, init))
  }

  /** Sends once, without retries: retrying a timed-out send may duplicate email. */
  async sendEmail(
    input: SendEmailRequest,
    options: { signal?: AbortSignal } = {}
  ): Promise<SendEmailResult> {
    const timeout = AbortSignal.timeout(this.timeoutMs)
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeout])
      : timeout
    const response = await this.fetch(this.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        to: input.to,
        title: input.title,
        body: input.body,
      }),
      signal,
      redirect: "error",
    })
    if (!response.ok) {
      throw new CmailApiError(response.status, await response.text())
    }
    const result = sendEmailResultSchema.safeParse(await response.json())
    if (!result.success) {
      throw new Error("Cmail API returned an invalid send response", {
        cause: result.error,
      })
    }
    return result.data
  }
}
