// Public surface of the system module (doc/04 §7, rule 2).
export {
  AUDIT_PAGE_SIZE,
  discardFailedJob,
  getSystemStatus,
  listAuditLogs,
  reprocessWebhook,
  retryFailedJob,
  type AuditRow,
  type FailedJob,
} from "./admin"
export { loadOpsChecks, runOpsChecks } from "./ops-checks"
export type { OpsCheck } from "./ops-rules"
