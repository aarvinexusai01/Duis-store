import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"

test("home page renders without serious accessibility violations", async ({
  page,
}) => {
  await page.goto("/")
  await expect(page.getByRole("heading", { level: 1 })).toBeAttached()
  await expect(
    page
      .getByRole("navigation", { name: "Main" })
      .or(page.getByRole("button", { name: "Open menu" })),
  ).toBeVisible()

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze()
  const blocking = results.violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  )
  expect(blocking).toEqual([])
})

test("health endpoints report ok", async ({ request }) => {
  const live = await request.get("/api/health")
  expect(live.status()).toBe(200)
  expect(await live.json()).toEqual({ status: "ok" })

  const ready = await request.get("/api/health/ready")
  expect(ready.status()).toBe(200)
})

test("responses carry a request id and baseline security headers", async ({
  request,
}) => {
  const response = await request.get("/")
  const headers = response.headers()
  expect(headers["x-request-id"]).toMatch(/^[A-Za-z0-9-]{8,64}$/)
  expect(headers["x-content-type-options"]).toBe("nosniff")
  expect(headers["x-frame-options"]).toBe("DENY")
  expect(headers["x-powered-by"]).toBeUndefined()
})
