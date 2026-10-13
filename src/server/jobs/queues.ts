/**
 * Every queue the worker knows about. Names use `domain.action` (pg-boss
 * allows letters, digits, `_`, `-`, `.` and `/`). Phase 1+ adds the queues in
 * doc/02-architecture.md §4.5.
 */
export const QUEUES = {
  systemHeartbeat: "system.heartbeat",
} as const

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES]
