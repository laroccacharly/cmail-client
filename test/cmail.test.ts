import { describe, expect, test } from "bun:test"
import { once } from "node:events"

import { ConfigProvider, Effect, Exit, Option, Redacted } from "effect"
import type { Config, Layer } from "effect"
import { FetchHttpClient } from "effect/http"
import type { HttpClient } from "effect/http"

import { Cmail, CmailError } from "../index.ts"

const input = { to: "someone@gmail.com", title: "Hello", body: "Test message" }
const result = {
  id: 1,
  messageId: "message-1",
  to: input.to,
  from: "sender@example.com",
  title: input.title,
}

// Runs one send through the Cmail service, with fetch answered by `transport`.
const sendWith = async (
  layer: Layer.Layer<
    Cmail,
    CmailError | Config.ConfigError,
    HttpClient.HttpClient
  >,
  transport: (request: Request) => Promise<Response> | Response,
  env: Record<string, string> = {}
) =>
  await Effect.runPromiseExit(
    Cmail.use((cmail) => cmail.sendEmail(input)).pipe(
      Effect.provide(layer),
      Effect.provide(FetchHttpClient.layer),
      Effect.provideService(
        FetchHttpClient.Fetch,
        Object.assign(
          async (url: RequestInfo | URL, init?: RequestInit) =>
            await transport(new Request(url, init)),
          { preconnect: globalThis.fetch.preconnect }
        )
      ),
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromEnv({ env })
      )
    )
  )

const layer = Cmail.layer({
  apiKey: Redacted.make("test-key"),
  origin: "https://cmail.example.com",
})

const cmailError = (
  exit: Exit.Exit<unknown, CmailError | Config.ConfigError>
): CmailError => {
  const error = Exit.findErrorOption(exit)
  if (Option.isNone(error) || !(error.value instanceof CmailError)) {
    throw new Error("Expected a CmailError", { cause: exit })
  }
  return error.value
}

describe("Cmail service", () => {
  test("reads its key and origin from config and sends", async () => {
    const requests: Request[] = []
    const exit = await sendWith(
      Cmail.layerConfig,
      (request) => {
        requests.push(request)
        return Response.json(result, { status: 201 })
      },
      { CMAIL_API_KEY: "env-key", CMAIL_ORIGIN: "https://cmail.example.com" }
    )
    expect(exit).toEqual(Exit.succeed(result))
    const [request] = requests
    expect(request?.url).toBe("https://cmail.example.com/api/email/send")
    expect(request?.headers.get("Authorization")).toBe("Bearer env-key")
    expect(await request?.json()).toEqual(input)
  })

  test("fails with a Config error without an API key", async () => {
    const exit = await sendWith(Cmail.layerConfig, () => Response.json(result))
    expect(Exit.isFailure(exit)).toBe(true)
    expect(
      await sendWith(Cmail.layer({ apiKey: Redacted.make(" ") }), () =>
        Response.json(result)
      ).then(cmailError)
    ).toMatchObject({ reason: "Config" })
  })

  test("types each failure by reason", async () => {
    const status = cmailError(
      await sendWith(layer, () =>
        Response.json({ error: "unauthorized" }, { status: 401 })
      )
    )
    expect(status).toBeInstanceOf(CmailError)
    expect(status).toMatchObject({ reason: "Status", status: 401 })
    expect(status.message).toContain("unauthorized")

    const invalid = cmailError(
      await sendWith(layer, () => Response.json({ ok: true }))
    )
    expect(invalid.reason).toBe("InvalidResponse")

    const transport = cmailError(
      await sendWith(layer, () => {
        throw new Error("Network unavailable")
      })
    )
    expect(transport).toMatchObject({
      reason: "Transport",
      detail: "Network unavailable",
    })
  })

  test("times out a send that does not answer", async () => {
    const slow = Cmail.layer({
      apiKey: Redacted.make("test-key"),
      timeout: "10 millis",
    })
    const error = cmailError(
      await sendWith(slow, async (request) => {
        await once(request.signal, "abort")
        throw new Error("aborted")
      })
    )
    expect(error.reason).toBe("Timeout")
  })
})
