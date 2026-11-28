import { expect, test } from "@playwright/test";

test("the app starts, with its introduction and no errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });

  await page.goto("/");

  await expect(page).toHaveTitle("Solid Demonstrator");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Solid Demonstrator");
  await expect(page.getByRole("main")).toContainText("With Solid, your data lives in a Pod");
  expect(errors).toEqual([]);
});
