import { Effect, Exit, Option, Redacted } from "effect"
import { FetchHttpClient } from "effect/http"

import { Cmail, CmailError, DEFAULT_ORIGIN } from "./cmail.ts"
import type { SendEmailRequest, SendEmailResult } from "./cmail.ts"

export {
  Cmail,
  CmailError,
  DEFAULT_ORIGIN,
  SendEmailRequestSchema,
  SendEmailResultSchema,
} from "./cmail.ts"
export type {
  CmailOptions,
  SendEmailRequest,
  SendEmailResult,
} from "./cmail.ts"

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

// Rejects as the client did before it was built on the Cmail service.
const toPromiseError = (error: CmailError): unknown => {
  if (error.reason === "Status") {
    return new CmailApiError(error.status ?? 0, error.detail)
  }
  if (error.reason === "Transport") {
    return error.cause
  }
  if (error.reason === "Timeout") {
    return new DOMException(error.detail, "TimeoutError")
  }
  return new Error(error.detail, { cause: error.cause })
}

/** A Promise client for cmail's authenticated outbound email API. Effect code should use the Cmail service. */
export class CmailClient {
  private readonly layer: ReturnType<typeof Cmail.layer>
  private readonly fetch: CmailFetch | undefined

  constructor(options: CmailClientOptions) {
    if (!options.apiKey.trim()) {
      throw new Error("apiKey must not be empty")
    }
    const timeoutMs = options.timeoutMs ?? 30_000
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
      throw new Error("timeoutMs must be a positive integer")
    }
    this.layer = Cmail.layer({
      apiKey: Redacted.make(options.apiKey),
      origin: options.origin ?? DEFAULT_ORIGIN,
      timeout: timeoutMs,
    })
    this.fetch = options.fetch
  }

  /** Sends once, without retries: retrying a timed-out send may duplicate email. */
  async sendEmail(
    input: SendEmailRequest,
    options: { signal?: AbortSignal } = {}
  ): Promise<SendEmailResult> {
    const custom = this.fetch
    const send = Cmail.use((cmail) => cmail.sendEmail(input)).pipe(
      Effect.provide(this.layer),
      Effect.provide(FetchHttpClient.layer),
      custom === undefined
        ? (effect) => effect
        : Effect.provideService(
            FetchHttpClient.Fetch,
            Object.assign(
              async (url: RequestInfo | URL, init?: RequestInit) =>
                await custom(
                  new URL(url instanceof Request ? url.url : url),
                  init ?? {}
                ),
              { preconnect: globalThis.fetch.preconnect }
            )
          )
    )
    const exit = await Effect.runPromiseExit(send, { signal: options.signal })
    if (Exit.isSuccess(exit)) {
      return exit.value
    }
    options.signal?.throwIfAborted()
    const error = Exit.findErrorOption(exit)
    if (Option.isSome(error) && error.value instanceof CmailError) {
      throw toPromiseError(error.value)
    }
    throw new Error("Email send failed", { cause: exit.cause })
  }
}
