import { expect, test } from "@playwright/test";

test("plays Alice's journey chapter by chapter, every step badged as an example", async ({
  page,
}) => {
  await page.goto("/");
  const introduction = page.locator("solid-introduction");
  await expect(introduction.getByRole("heading", { name: "Who's involved" })).toBeVisible();
  await expect(introduction.locator("trace-timeline")).toHaveCount(0);

  await introduction.getByRole("button", { name: "Next chapter" }).click();
  await expect(
    introduction.getByRole("heading", { name: "Finding Alice's servers" }),
  ).toBeVisible();
  const timeline = introduction.locator("trace-timeline");
  await expect(timeline.getByText(/Example: Alice's journey/)).toBeVisible();
  await expect(timeline.locator("li")).toHaveCount(2);
  await expect(timeline.getByText("Step 2 of 2")).toBeVisible();
  await expect(
    timeline.getByRole("complementary").getByText("Example, not a live exchange"),
  ).toBeVisible();
  await expect(timeline.getByRole("button", { name: "Download this trace" })).toHaveCount(0);
  await expect(
    timeline.locator("journey-map .card.expected"),
    "parties appear as they're found",
  ).toHaveCount(0);
  await expect(timeline.locator("journey-map .card.found")).toHaveCount(3);

  await introduction.getByRole("button", { name: "Next chapter" }).click();
  await expect(introduction.getByRole("heading", { name: "Logging in" })).toBeVisible();
  await expect(timeline.locator("li")).toHaveCount(8);
  await timeline.locator('li[data-step="exchangeCode"] button').click();
  const detail = timeline.getByRole("complementary");
  await expect(
    detail.getByText(/access token removed: its claims are shown separately/),
  ).toBeVisible();

  await introduction.getByRole("button", { name: "Back", exact: true }).click();
  await expect(
    introduction.getByRole("heading", { name: "Finding Alice's servers" }),
  ).toBeVisible();
  await expect(timeline.locator("li")).toHaveCount(2);

  await introduction.getByRole("button", { name: "Carry on" }).click();
  await expect(introduction.getByRole("button", { name: "Pause" })).toBeVisible();
  await expect(timeline.locator("li")).toHaveCount(3);
  await introduction.getByRole("button", { name: "Pause" }).click();
  await expect(introduction.getByRole("button", { name: "Carry on" })).toBeVisible();

  for (let chapter = 0; chapter < 4; chapter += 1) {
    await introduction.getByRole("button", { name: "Next chapter" }).click();
  }
  await expect(introduction.getByRole("heading", { name: "When the Pod says no" })).toBeVisible();
  await expect(introduction.getByRole("button", { name: "Next chapter" })).toBeDisabled();
  await expect(timeline.locator("li").last()).toHaveClass(/unexpected/);
  await expect(page.getByRole("heading", { name: "Try it yourself" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Get a Pod from a provider" })).toBeVisible();
});

test("leaves the introduction once the person starts their own journey", async ({ page }) => {
  await page.route("https://alice.example/**", (route) => route.abort());
  await page.goto("/");
  await page.getByLabel("WebID").fill("https://alice.example/profile#me");
  await page.getByRole("button", { name: "Discover" }).click();
  await expect(page.locator("solid-introduction")).toHaveCount(0);
});
