import { expect, test, type Page } from "@playwright/test";

const smokeUser = process.env.PROXCENTER_SMOKE_USER;
const smokePassword = process.env.PROXCENTER_SMOKE_PASSWORD;

async function login(page: Page) {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: /login/i })).toBeVisible();
  await page.getByLabel(/identifiant/i).fill(smokeUser ?? "");
  await page.getByLabel(/mot de passe/i).fill(smokePassword ?? "");
  await page.getByRole("button", { name: /ouvrir proxcenter/i }).click();
}

test("login page renders", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: /login/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /ouvrir proxcenter/i })).toBeVisible();
});

test("404 page renders", async ({ page }) => {
  await page.goto("/install/does-not-exist");
  await expect(page.getByText("404")).toBeVisible();
  await expect(page.getByRole("heading", { name: /page introuvable/i })).toBeVisible();
});

test("401 page renders", async ({ page }) => {
  await page.goto("/unauthorized?next=%2Fsettings");
  await expect(page.getByText("401")).toBeVisible();
  await expect(page.getByText("/settings")).toBeVisible();
});

test("403 page renders", async ({ page }) => {
  await page.goto("/forbidden?from=%2Fsettings");
  await expect(page.getByText("403")).toBeVisible();
  await expect(page.getByText("/settings")).toBeVisible();
});

test.describe("authenticated pages", () => {
  test.skip(!smokeUser || !smokePassword, "Set PROXCENTER_SMOKE_USER and PROXCENTER_SMOKE_PASSWORD to run authenticated smoke tests.");

  test("settings, observability and backups render", async ({ page }) => {
    await login(page);
    await expect(page.getByRole("heading", { name: /configuration/i })).toBeVisible();

    await page.goto("/observability");
    await expect(page.getByRole("heading", { name: /santé, greenit et recommandations/i })).toBeVisible();

    await page.goto("/backups");
    await expect(page.getByRole("heading", { name: /backups locaux \/ cloud/i })).toBeVisible();
  });
});
