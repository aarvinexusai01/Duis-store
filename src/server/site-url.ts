import "server-only"

import { getServerEnv } from "@/config/env"

/** Absolute URL on this site, from the runtime APP_URL (request time only). */
export function absoluteUrl(path: string): string {
  return new URL(path, getServerEnv().APP_URL).toString()
}
