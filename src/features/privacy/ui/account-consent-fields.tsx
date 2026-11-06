"use client"

import { setAccountConsentAction } from "../actions"
import { ConsentFields } from "./consent-fields"

/**
 * The account and "18 or older" boxes on sign-up and sign-in. Ticking both
 * sets the cookie Better Auth checks before it takes any personal data.
 *
 * `onChange` reports the tick at once, with `saved`: the form awaits it
 * before calling Better Auth, so a quick click never beats the cookie.
 */
export function AccountConsentFields({
  onChange,
}: {
  onChange: (ticked: boolean, saved: Promise<void>) => void
}) {
  return (
    <ConsentFields
      purposes={["account", "age"]}
      onChange={(allTicked, language) =>
        onChange(
          allTicked,
          setAccountConsentAction(allTicked ? language : null),
        )
      }
    />
  )
}
