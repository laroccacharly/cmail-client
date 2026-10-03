# cmail-client

A small TypeScript client for sending email through [cmail](https://cmail.laroccadev.com).

## Requirements

- Bun (or any TypeScript runtime with `fetch`)
- `effect` 4
- A cmail API key in `CMAIL_API_KEY`

## Setup

```sh
bun add github:laroccacharly/cmail-client
```

## Usage

### Effect

The `Cmail` service needs an `HttpClient`. `Cmail.layerConfig` reads `CMAIL_API_KEY` and, optionally, `CMAIL_ORIGIN`; `Cmail.layer({ apiKey, origin, timeout })` takes them directly.

```ts
import { Cmail } from "cmail-client"
import { Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/http"

const send = Effect.gen(function* () {
  const cmail = yield* Cmail
  return yield* cmail.sendEmail({
    to: "someone@gmail.com",
    title: "Hello",
    body: "Sent from cmail!",
  })
})

await Effect.runPromise(
  send.pipe(
    Effect.provide(Cmail.layerConfig.pipe(Layer.provide(FetchHttpClient.layer)))
  )
)
```

A send fails with a `CmailError` whose `reason` is `Config`, `Status`, `Transport`, `InvalidResponse` or `Timeout`. Sends are never retried: retrying a timed-out send may duplicate email.

### Promise

```ts
import { CmailClient } from "cmail-client"

const client = new CmailClient({ apiKey: process.env.CMAIL_API_KEY! })

await client.sendEmail({
  to: "someone@gmail.com",
  title: "Hello",
  body: "Sent from cmail!",
})
```

Or from the command line:

```sh
bunx cmail-send someone@gmail.com "Hello" "Sent from cmail!"
```
