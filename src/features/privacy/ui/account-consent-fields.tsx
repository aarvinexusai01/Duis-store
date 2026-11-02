"use client"

import { setAccountConsentAction } from "../actions"
import { ConsentFields } from "./consent-fields"

/**
 * The account and "18 or older" boxes on sign-up and sign-in. Ticking both
 * sets the cookie Better Auth checks before it takes any personal data.
 */
export function AccountConsentFields({
  onChange,
}: {
  onChange: (ready: boolean) => void
}) {
  return (
    <ConsentFields
      purposes={["account", "age"]}
      onChange={(allTicked, language) => {
        onChange(false)
        void setAccountConsentAction(allTicked ? language : null).then(() =>
          onChange(allTicked),
        )
      }}
    />
  )
}
