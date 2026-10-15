import { getCurrentCart } from "../queries"
import { CartButton } from "./cart-button"

/** Request-time island: reads the session and cart cookie. */
export async function HeaderCart() {
  return <CartButton cart={await getCurrentCart()} />
}
