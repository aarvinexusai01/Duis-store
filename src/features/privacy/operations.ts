// Server-only reads for routes. Kept out of index.ts, which client components
// import for the consent boxes.
export {
  adminDataRequests,
  exportMyData,
  getPrivacyOverview,
  type DataRequests,
  type PrivacyOverview,
} from "./service"
