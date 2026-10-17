// Public surface of the contact module (doc/04 §7, rule 2).
export {
  adminGetMessage,
  adminListMessages,
  MESSAGES_PAGE_SIZE,
  updateContactMessage,
  type ContactMessage,
} from "./admin"
export { sendContactMessage } from "./service"
export {
  CONTACT_STATUSES,
  CONTACT_TOPICS,
  type ContactStatus,
  type ContactTopic,
} from "./schemas"
