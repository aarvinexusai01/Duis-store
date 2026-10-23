import { describe, expect, it } from "vitest"

import { OWNER_CHARTS } from "./owner-size-charts.fixture"
import { convertMeasurement } from "./size-units"

describe("convertMeasurement", () => {
  it.each(Object.entries(OWNER_CHARTS))(
    "reproduces the owner's centimetre table for %s",
    (_name, { inches, cm }) => {
      expect(
        inches.map((row) =>
          row.map((value) => convertMeasurement(value, "in", "cm")),
        ),
      ).toEqual(cm)
    },
  )

  it("converts back to inches and leaves non-numbers alone", () => {
    expect(convertMeasurement("60.0", "cm", "in")).toBe("23.622")
    expect(convertMeasurement("101.6", "cm", "in")).toBe("40")
    expect(convertMeasurement("Free size", "in", "cm")).toBe("Free size")
    expect(convertMeasurement("44", "in", "in")).toBe("44")
  })
})
