import { describe, expect, test } from "bun:test"
import { once } from "node:events"

import { CmailApiError, CmailClient } from "../index.ts"

const input = { to: "someone@gmail.com", title: "Hello", body: "Test message" }
const result = {
  id: 1,
  messageId: "message-1",
  to: input.to,
  from: "sender@example.com",
  title: input.title,
}

const clientWith = (transport: (url: URL, init: RequestInit) => Response) =>
  new CmailClient({
    origin: "https://cmail.example.com/",
    apiKey: "test-key",
    fetch: async (url, init) => await Promise.resolve(transport(url, init)),
  })

// Like fetch on Cloudflare Workers, which throws unless called unbound or on globalThis, and rejects
// redirect: "error".
const workersFetch = async function workersFetch(
  this: unknown,
  _url: URL | RequestInfo,
  init?: RequestInit
) {
  if (this !== undefined && this !== globalThis) {
    throw new TypeError("Illegal invocation")
  }
  if (
    init?.redirect !== undefined &&
    init.redirect !== "follow" &&
    init.redirect !== "manual"
  ) {
    throw new TypeError(
      'Invalid redirect value, must be one of "follow" or "manual"'
    )
  }
  return await Promise.resolve(Response.json(result))
}

const failure = async (promise: Promise<unknown>): Promise<Error> => {
  try {
    await promise
  } catch (error) {
    if (error instanceof Error) {
      return error
    }
    throw new Error("Expected an Error rejection", { cause: error })
  }
  throw new Error("Expected request to fail")
}

describe("standalone cmail client", () => {
  test("sends an authenticated JSON request and returns the result", async () => {
    const requests: Request[] = []
    const client = clientWith((url, init) => {
      expect(init.redirect).toBe("manual")
      requests.push(new Request(url, init))
      return Response.json(result, { status: 201 })
    })

    expect(await client.sendEmail(input)).toEqual(result)
    expect(requests).toHaveLength(1)
    const [request] = requests
    if (request === undefined) {
      throw new Error("Expected a request")
    }
    expect(request.url).toBe("https://cmail.example.com/api/email/send")
    expect(request.method).toBe("POST")
    expect(request.headers.get("Authorization")).toBe("Bearer test-key")
    expect(request.headers.get("Content-Type")).toBe("application/json")
    const body: unknown = JSON.parse(await request.text())
    expect(body).toEqual(input)
  })

  test("exposes HTTP errors without retrying", async () => {
    let calls = 0
    const client = clientWith(() => {
      calls += 1
      return Response.json({ error: "unauthorized" }, { status: 401 })
    })
    const error = await failure(client.sendEmail(input))
    expect(error).toBeInstanceOf(CmailApiError)
    if (!(error instanceof CmailApiError)) {
      throw new Error("Expected CmailApiError")
    }
    expect(error.status).toBe(401)
    expect(error.message).toContain("unauthorized")
    expect(calls).toBe(1)
  })

  test("fails on a redirect instead of following it with the API key", async () => {
    let calls = 0
    const client = clientWith(() => {
      calls += 1
      return new Response(null, {
        status: 302,
        headers: { Location: "https://elsewhere.example.com/" },
      })
    })
    const error = await failure(client.sendEmail(input))
    expect(error).toBeInstanceOf(CmailApiError)
    expect(calls).toBe(1)
  })

  test("rejects malformed success responses", async () => {
    const client = clientWith(() => Response.json({ ok: true }))
    const error = await failure(client.sendEmail(input))
    expect(error.message).toContain("invalid send response")
  })

  test("propagates transport errors", async () => {
    const client = clientWith(() => {
      throw new Error("Network unavailable")
    })
    const error = await failure(client.sendEmail(input))
    expect(error.message).toBe("Network unavailable")
  })

  test("passes cancellation to the transport", async () => {
    const controller = new AbortController()
    let transportAborted = false
    const client = new CmailClient({
      apiKey: "test-key",
      fetch: async (_url, init) => {
        const { signal } = init
        if (!signal) {
          throw new Error("Expected a signal")
        }
        const aborted = once(signal, "abort")
        controller.abort()
        await aborted
        transportAborted = true
        throw new Error("aborted")
      },
    })
    const error = await failure(
      client.sendEmail(input, { signal: controller.signal })
    )
    expect(error.name).toBe("AbortError")
    expect(transportAborted).toBe(true)
  })

  test("calls the global fetch as Workers require", async () => {
    const globalFetch = globalThis.fetch
    globalThis.fetch = Object.assign(workersFetch, {
      preconnect: globalFetch.preconnect,
    })
    try {
      const client = new CmailClient({ apiKey: "test-key" })
      expect(await client.sendEmail(input)).toEqual(result)
    } finally {
      globalThis.fetch = globalFetch
    }
  })

  test("rejects invalid configuration", () => {
    expect(
      () => new CmailClient({ origin: "https://example.com", apiKey: " " })
    ).toThrow("apiKey")
    expect(
      () =>
        new CmailClient({
          origin: "https://example.com",
          apiKey: "key",
          timeoutMs: 0,
        })
    ).toThrow("timeoutMs")
  })
})
