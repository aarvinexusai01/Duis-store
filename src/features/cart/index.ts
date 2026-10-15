// Public surface of the cart module (doc/04 §7, rule 2).
export {
  addCartItem,
  buildView,
  getCart,
  mergeGuestCart,
  updateCartItem,
  type CartLine,
  type CartLineIssue,
  type CartView,
} from "./service"
export { CART_COOKIE } from "./cookie"
