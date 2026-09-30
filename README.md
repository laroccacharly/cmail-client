# cmail-client

A small TypeScript client for sending email through [cmail](https://cmail.laroccadev.com).

## Requirements

- Bun (or any TypeScript runtime with `fetch`)
- A cmail API key in `CMAIL_API_KEY`

## Setup

```sh
bun add github:laroccacharly/cmail-client
```

## Usage

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
