import {
  Config,
  Context,
  Duration,
  Effect,
  Layer,
  Option,
  Redacted,
  Schema,
} from "effect"
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/http"

export const DEFAULT_ORIGIN = "https://cmail.laroccadev.com"

export const SendEmailRequestSchema = Schema.Struct({
  to: Schema.String,
  title: Schema.String,
  body: Schema.String,
})
export type SendEmailRequest = typeof SendEmailRequestSchema.Type

export const SendEmailResultSchema = Schema.Struct({
  id: Schema.Int,
  messageId: Schema.String,
  to: Schema.String,
  from: Schema.String,
  title: Schema.String,
})
export type SendEmailResult = typeof SendEmailResultSchema.Type

/** Why a send failed: a non-2xx status, an unreachable server, an unexpected response body, or a timeout. */
export class CmailError extends Schema.TaggedError<CmailError>()("CmailError", {
  reason: Schema.Literals([
    "Config",
    "Status",
    "Transport",
    "InvalidResponse",
    "Timeout",
  ]),
  detail: Schema.String,
  status: Schema.optional(Schema.Int),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return this.status === undefined
      ? this.detail
      : `Cmail API returned HTTP ${this.status}: ${this.detail}`
  }
}

export interface CmailOptions {
  readonly apiKey: Redacted.Redacted
  /** Worker origin. Defaults to https://cmail.laroccadev.com. */
  readonly origin?: string | undefined
  /** Defaults to 30 seconds. */
  readonly timeout?: Duration.Input | undefined
}

const configError = (detail: string) =>
  new CmailError({ reason: "Config", detail })

/** cmail's authenticated outbound email API. Needs an HttpClient, e.g. FetchHttpClient.layer. */
export class Cmail extends Context.Service<
  Cmail,
  {
    /** Sends once, without retries: retrying a timed-out send may duplicate email. */
    readonly sendEmail: (
      input: SendEmailRequest
    ) => Effect.Effect<SendEmailResult, CmailError>
  }
>()("cmail-client/Cmail") {
  static readonly make = Effect.fnUntraced(function* make(
    options: CmailOptions
  ) {
    if (!Redacted.value(options.apiKey).trim()) {
      return yield* configError("apiKey must not be empty")
    }
    const timeout = Duration.fromInputUnsafe(options.timeout ?? "30 seconds")
    if (!Duration.isGreaterThan(timeout, Duration.zero)) {
      return yield* configError("timeout must be positive")
    }
    const endpoint = new URL(
      "/api/email/send",
      options.origin ?? DEFAULT_ORIGIN
    )
    const client = yield* HttpClient.HttpClient

    const sendEmail = Effect.fn("Cmail.sendEmail")(
      function* sendEmail(input: SendEmailRequest) {
        const response = yield* HttpClientRequest.post(endpoint).pipe(
          HttpClientRequest.bearerToken(options.apiKey),
          HttpClientRequest.acceptJson,
          HttpClientRequest.bodyJsonUnsafe({
            to: input.to,
            title: input.title,
            body: input.body,
          }),
          client.execute,
          // Hands a redirect back as a failed response rather than following it with the API key. Workers
          // reject redirect: "error".
          Effect.provideService(FetchHttpClient.RequestInit, {
            redirect: "manual",
          }),
          Effect.mapError(
            (error) =>
              new CmailError({
                reason: "Transport",
                detail:
                  error.cause instanceof Error
                    ? error.cause.message
                    : error.message,
                cause: error.cause ?? error,
              })
          )
        )
        if (response.status < 200 || response.status >= 300) {
          const detail = yield* response.text.pipe(
            Effect.orElseSucceed(() => "")
          )
          return yield* new CmailError({
            reason: "Status",
            status: response.status,
            detail,
          })
        }
        return yield* HttpClientResponse.schemaBodyJson(SendEmailResultSchema)(
          response
        ).pipe(
          Effect.mapError(
            (cause) =>
              new CmailError({
                reason: "InvalidResponse",
                detail: "Cmail API returned an invalid send response",
                cause,
              })
          )
        )
      },
      Effect.timeoutOrElse({
        duration: timeout,
        orElse: () =>
          Effect.fail(
            new CmailError({
              reason: "Timeout",
              detail: `Cmail API did not respond within ${Duration.format(timeout)}`,
            })
          ),
      })
    )

    return Cmail.of({ sendEmail })
  })

  static readonly layer = (options: CmailOptions) =>
    Layer.effect(Cmail, Cmail.make(options))

  /** Reads CMAIL_API_KEY and, optionally, CMAIL_ORIGIN. */
  static readonly layerConfig = Layer.effect(
    Cmail,
    Effect.gen(function* layerConfig() {
      const apiKey = yield* Config.schema(
        Schema.Redacted(Schema.NonEmptyString),
        "CMAIL_API_KEY"
      )
      const origin = yield* Config.option(Config.NonEmptyString("CMAIL_ORIGIN"))
      return yield* Cmail.make({
        apiKey,
        origin: Option.getOrUndefined(origin),
      })
    })
  )
}
