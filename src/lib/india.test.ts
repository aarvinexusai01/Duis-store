import { describe, expect, it } from "vitest"

import { INDIAN_STATE_CODES, stateName, suggestStateForPincode } from "./india"

describe("stateName", () => {
  it("names a state code", () => {
    expect(stateName("IN-UP")).toBe("Uttar Pradesh")
    expect(stateName("IN-XX")).toBeNull()
  })
})

describe("suggestStateForPincode", () => {
  it.each([
    ["110001", "IN-DL"],
    ["400001", "IN-MH"],
    ["403001", "IN-GA"],
    ["560001", "IN-KA"],
    ["600001", "IN-TN"],
    ["605001", "IN-PY"],
    ["700001", "IN-WB"],
    ["737101", "IN-SK"],
    ["160017", "IN-CH"],
    ["248001", "IN-UK"],
    ["834001", "IN-JH"],
    ["800001", "IN-BR"],
  ])("%s → %s", (pincode, state) => {
    expect(suggestStateForPincode(pincode)).toBe(state)
  })

  it("only suggests known codes and ignores invalid PINs", () => {
    expect(suggestStateForPincode("012345")).toBeNull()
    expect(suggestStateForPincode("56001")).toBeNull()
    for (const pin of ["110001", "799001", "682551"]) {
      expect(INDIAN_STATE_CODES.has(suggestStateForPincode(pin)!)).toBe(true)
    }
  })
})
