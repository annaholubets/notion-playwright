import {Config} from "../config/env.js";
import {Locator, Page} from "playwright";
import {logger} from "../utils/logger.js";
import {URLs} from "../config/constants.js";
import {authenticator} from "otplib";

export class GoogleAuthService {
  constructor(private readonly config: Config) {}

  /**
   * Checks whether the current browser profile is already authenticated in
   * Notion by waiting for the sidebar switcher
   */
  async isLoggedIn(page: Page): Promise<boolean> {
    try {
      logger.info("Checking if session is already authenticated");
      await page.goto(URLs.notion, {
        waitUntil: "domcontentloaded",
      });

      const url = page.url();
      if (url.includes("login") || url.includes("sign-in")) {
        return false;
      }

      const sidebar = page.locator('nav, [role="navigation"]');

      return await sidebar.first().waitFor({
        state: "visible",
        timeout: 5000,
      }).then(() => true).catch(() => false);
    } catch {
      return false;
    }
  }

  /**
   * Starts the Notion "Continue with Google" flow and waits until the popup
   * login process completes
   */
  async login(page: Page): Promise<void> {
    const googleButton = page.getByRole("button", { name: /google|continue with google/i });

    logger.info("Initiating Google login");

    // Notion opens Google authentication in a popup
    const [popup] = await Promise.all([
      page.waitForEvent("popup", { timeout: 15_000 }),
      googleButton.click(),
    ]);

    if (!popup) {
      throw new Error("Google login popup did not appear.");
    }

    await this.completeGoogleLogin(popup, this.config);

    await popup.waitForEvent('close', { timeout: 30_000 }).catch(() => null);
    logger.info("Google login completed");

    await page.waitForURL(/notion\.(so|com)/, { timeout: 120_000 });
  }

  /**
   * Completes the Google login flow for the current popup, including account
   * selection, credentials, optional TOTP, and consent screens
   */
  async completeGoogleLogin(page: Page, config: Config): Promise<void> {
    if (!config.googleEmail || !config.googlePassword) {
      throw new Error("Google email and password are required");
    }

    // Google may show an account picker, an email form, or a password form
    // depending on the saved browser profile state
    await Promise.race([
      page.getByText(/choose an account/i).waitFor({ state: "visible", timeout: 20_000 }).catch(() => null),
      page.locator("[data-email]").first().waitFor({ state: "visible", timeout: 20_000 }).catch(() => null),
      this.visibleEmailInput(page).waitFor({ state: "visible", timeout: 20_000 }).catch(() => null),
      this.visiblePasswordInput(page).waitFor({ state: "visible", timeout: 20_000 }).catch(() => null)
    ]);

    const onAccountPicker =
      await page.getByText(/choose an account/i).isVisible() ||
      await page.locator("[data-email]").first().isVisible();

    if (onAccountPicker) {
      logger.info("Picking Google account");
      const picked = await this.pickGoogleAccount(page, config.googleEmail);
      if (!picked) {
        await page.getByRole("link", { name: /use another account/i }).click();
        await this.fillEmail(page, config.googleEmail);
        await this.fillPassword(page, config.googlePassword);
      } else {
        await page.waitForLoadState("domcontentloaded");
      }
    } else if (await this.visibleEmailInput(page).isVisible()) {
      logger.info("Filling in Google email and password");
      await this.fillEmail(page, config.googleEmail);
      await this.fillPassword(page, config.googlePassword);
    } else if (await this.visiblePasswordInput(page).isVisible()) {
      await this.fillPassword(page, config.googlePassword);
    } else {
      throw new Error("Failed to determine Google login screen state after waiting");
    }

    if (config.googleTotpSecret) {
      const totpInput = page
        .locator('input[name="totpPin"]:not([aria-hidden="true"]), ' +
          'input[type="tel"]:not([aria-hidden="true"])')
        .first();
      if (await totpInput.isVisible({ timeout: 8_000 }).catch(() => false)) {
        await this.fillTotp(page, config.googleTotpSecret);
      }
    }

    await this.endGoogleLogin(page);
  }

  /**
   * Selects a saved Google account matching the configured email, when it is
   * present on the account picker screen
   */
  async pickGoogleAccount(page: Page, email: string): Promise<boolean> {
    const accountTile = page.locator(`[data-email="${email}"]`).first();
    if (await accountTile.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await accountTile.click();
      return true;
    }

    const accountByText = page.getByText(email, { exact: false });
    if (await accountByText.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await accountByText.click();
      return true;
    }

    return false;
  }

  /**
   * Returns the currently visible Google email input
   */
  visibleEmailInput(page: Page): Locator {
    return page
      .locator('input[type="email"]:not([aria-hidden="true"]), ' +
        'input[name="identifier"]:not([aria-hidden="true"])')
      .first()
  }

  /**
   * Returns the currently visible Google password input
   */
  visiblePasswordInput(page: Page): Locator {
    return page
      .locator('input[name="Passwd"]:not([aria-hidden="true"]), ' +
        'input[type="password"]:not([aria-hidden="true"])')
      .first();
  }

  /**
   * Waits for an input and fills it with the provided text
   */
  async fillField(locator: Locator, text: string): Promise<void> {
    await locator.waitFor({ state: "visible", timeout: 30_000 });
    await locator.click();
    await locator.fill(text);
  }

  /**
   * Fills the Google email step
   */
  private async fillEmail(page: Page, email: string): Promise<void> {
    const emailInput = this.visibleEmailInput(page);
    await this.fillField(emailInput, email);
    await this.clickNext(page);
    await page.waitForLoadState("domcontentloaded");
  }

  /**
   * Fills the Google password step
   */
  private async fillPassword(page: Page, password: string): Promise<void> {
    const passwordInput = this.visiblePasswordInput(page);
    await this.fillField(passwordInput, password);
    await this.clickNext(page);
    await page.waitForLoadState("domcontentloaded");
  }

  /**
   * Generates and submits a TOTP verification code when two-factor
   * authentication is requested
   */
  private async fillTotp(page: Page, secret: string): Promise<void> {
    const code = authenticator.generate(secret);
    const totpInput = page
      .locator('input[name="totpPin"]:not([aria-hidden="true"]), input[type="tel"]:not([aria-hidden="true"])')
      .first();
    await totpInput.waitFor({ state: "visible", timeout: 15_000 });
    await this.fillField(totpInput, code);
    await page.getByRole("button", { name: /next|verify/i }).click();
  }

  /**
   * Clicks the primary Google "Next" or "Continue" button
   */
  private async clickNext(page: Page): Promise<void> {
    const nextButton = page.getByRole("button", { name: /^(next|continue)$/i }).first();
    await nextButton.click();
  }

  /**
   * Clicks through any final Google OAuth confirmation or consent prompts
   */
  private async endGoogleLogin(page: Page): Promise<void> {
    // OAuth consent screens can present one or more confirmation steps after
    // credentials are accepted.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const continueButton = page.getByRole("button", {
        name: /continue|allow|yes|accept|confirm/i,
      });
      if (await continueButton.first().isVisible({ timeout: 2_000 }).catch(() => false)) {
        await continueButton.first().click();
        await page.waitForLoadState("domcontentloaded");
      } else {
        break;
      }
    }
  }
}
