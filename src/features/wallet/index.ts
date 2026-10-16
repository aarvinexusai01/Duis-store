// Public surface of the wallet module (doc/04 §7, rule 2).
export {
  creditWallet,
  debitWallet,
  expireWalletCredits,
  getWalletSummary,
  grantGoodwillCredit,
  reverseDebit,
  spendableBalance,
  type WalletReason,
  type WalletSummary,
} from "./service"
