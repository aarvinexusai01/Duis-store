import { Client } from "pg"

import { getServerEnv } from "@/config/env"
import { logger } from "@/server/observability/logger"

/**
 * A dedicated Postgres connection that LISTENs on one channel and reconnects
 * after any failure. Notifications sent while it's disconnected are lost, so
 * `onConnect` runs after every (re)connect for the caller to catch up.
 */

const RETRY_MS = 5_000

export type Listener = { stop(): Promise<void> }

export function listen(options: {
  channel: string
  name: string
  onNotify: (payload: string) => void
  onConnect: () => Promise<void> | void
}): Listener {
  let client: Client | null = null
  let stopped = false
  let retry: NodeJS.Timeout | undefined

  const reconnectLater = () => {
    if (stopped || retry) return
    const old = client
    client = null
    old?.removeAllListeners()
    void old?.end().catch(() => {})
    retry = setTimeout(() => {
      retry = undefined
      void connect()
    }, RETRY_MS)
  }

  const connect = async () => {
    const next = new Client({
      connectionString: getServerEnv().DATABASE_URL,
      application_name: `duis-${options.name}`,
    })
    client = next
    next.on("notification", (message) => {
      if (message.channel === options.channel) {
        options.onNotify(message.payload ?? "")
      }
    })
    next.on("error", (err) => {
      logger.warn(
        { err, listener: options.name },
        "listener lost its connection",
      )
      reconnectLater()
    })
    next.on("end", reconnectLater)
    try {
      await next.connect()
      await next.query(`LISTEN ${options.channel}`)
      await options.onConnect()
      logger.info({ listener: options.name }, "listener ready")
    } catch (err) {
      logger.warn(
        { err, listener: options.name },
        "listener could not start; retrying",
      )
      reconnectLater()
    }
  }

  void connect()

  return {
    async stop() {
      stopped = true
      clearTimeout(retry)
      const last = client
      client = null
      last?.removeAllListeners()
      await last?.end().catch(() => {})
    },
  }
}
