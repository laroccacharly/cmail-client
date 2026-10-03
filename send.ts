#!/usr/bin/env bun
import { Effect, Exit, Option, Schema } from "effect"
import { FetchHttpClient } from "effect/http"

import { Cmail, CmailError } from "./index.ts"

const Args = Schema.Tuple([
  Schema.NonEmptyString,
  Schema.NonEmptyString,
  Schema.NonEmptyString,
])

const send = Effect.gen(function* send() {
  const [to, title, body] = yield* Schema.decodeUnknownEffect(Args)(
    Bun.argv.slice(2)
  )
  const cmail = yield* Cmail
  return yield* cmail.sendEmail({ to, title, body })
}).pipe(
  Effect.provide(Cmail.layerConfig),
  Effect.provide(FetchHttpClient.layer)
)

const exit = await Effect.runPromiseExit(send)
if (Exit.isSuccess(exit)) {
  console.log(JSON.stringify(exit.value, null, 2))
} else {
  const error = Exit.findErrorOption(exit)
  console.error(
    Option.isSome(error) && error.value instanceof CmailError
      ? error.value.message
      : 'Usage: CMAIL_API_KEY=... [CMAIL_ORIGIN=https://cmail.laroccadev.com] cmail-send recipient@gmail.com "Subject" "Message"'
  )
  process.exitCode = 1
}
