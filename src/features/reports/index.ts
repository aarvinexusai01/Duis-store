// Public surface of the reports module (doc/04 §7, rule 2).
export {
  operationsSummary,
  salesSummary,
  type OperationsSummary,
  type SalesSummary,
} from "./dashboard"
export {
  codRemittanceReport,
  exportCodCsv,
  exportGstCsv,
  exportSalesCsv,
  salesReport,
  type CodReport,
  type SalesReport,
} from "./reports"
export {
  exportCustomersCsv,
  exportInventoryCsv,
  exportOrdersCsv,
  exportProductsCsv,
} from "./exports"
