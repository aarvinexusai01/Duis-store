// Public surface of the staff module (doc/04 §7, rule 2).
export { can, requireStaff } from "./guard"
export { ADMIN_NAV, type AdminNavGroup, type AdminNavItem } from "./nav"
export {
  acceptInvitation,
  getInvitation,
  inviteStaff,
  listStaff,
  resetStaffTwoFactor,
  revokeInvitation,
  revokeStaffSessions,
  ROLE_LABEL,
  setStaffActive,
  setStaffRoles,
  type InvitationView,
  type PendingInvitation,
  type StaffMember,
} from "./admin"
export { adminSearch, type SearchHit } from "./search"
