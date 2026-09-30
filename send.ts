#!/usr/bin/env bun
import { z } from "zod"

import { CmailClient } from "./index.ts"

const [to, title, body] = Bun.argv.slice(2)
const nonEmpty = z.string().min(1)
const input = z
  .object({
    CMAIL_ORIGIN: nonEmpty.optional(),
    CMAIL_API_KEY: nonEmpty,
    to: nonEmpty,
    title: nonEmpty,
    body: nonEmpty,
  })
  .safeParse({ ...Bun.env, to, title, body })

if (!input.success) {
  console.error(
    'Usage: CMAIL_API_KEY=... [CMAIL_ORIGIN=https://cmail.laroccadev.com] cmail-send recipient@gmail.com "Subject" "Message"'
  )
  process.exit(1)
}

const { CMAIL_ORIGIN, CMAIL_API_KEY, ...email } = input.data

try {
  const client = new CmailClient({
    origin: CMAIL_ORIGIN,
    apiKey: CMAIL_API_KEY,
  })
  console.log(JSON.stringify(await client.sendEmail(email), null, 2))
} catch (error) {
  console.error(error instanceof Error ? error.message : "Email send failed")
  process.exitCode = 1
}
