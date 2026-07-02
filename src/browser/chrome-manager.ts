import {existsSync} from "node:fs";
import path from "node:path";
import {Config} from "../config/env.js";
import {logger} from "../utils/logger.js";
import {spawn} from "node:child_process";
import {URLs} from "../config/constants.js";
import {BrowserSession} from "../types/browser-session.js";
import {chromium} from "playwright";
import * as ChromeLauncher from "chrome-launcher";

export class ChromeManager {
  static resolveExecutable(): string {
    const fromEnv = process.env.CHROME_EXECUTABLE?.trim();
    if (fromEnv && existsSync(fromEnv)) {
      return fromEnv;
    }

    const installations = ChromeLauncher.Launcher.getInstallations();

    const chrome = installations.find(existsSync);
    if (chrome) {
      return chrome;
    }

    throw new Error(
      "Unable to locate Chrome. Set CHROME_EXECUTABLE in your .env."
    );
  }

  /**
   * Launches a standalone Chrome instance
   */
  static spawnNative(config: Config): void {
    const chromePath = this.resolveExecutable();
    const profileDir = path.resolve(config.browserProfileDir);
    const cdpUrl = new URL(config.chromeCdpUrl);
    const debugPort = cdpUrl.port || "9222";

    logger.info(`Spawning Chrome on port ${debugPort}`);

    // A detached Chrome process keeps the authenticated profile available for
    // Playwright while this Node process only connects through CDP.
    const child = spawn(
      chromePath,
      [
        `--remote-debugging-port=${debugPort}`,
        `--user-data-dir=${profileDir}`,
        "--no-first-run",
        "--no-default-browser-check",
        URLs.notion,
      ],
      { detached: true, stdio: "ignore", windowsHide: false },
    );

    child.unref();
  }

  /**
   * Connects Playwright to Chrome over CDP and returns the active Notion page
   */
  static async connect(config: Config, timeout = 15_000): Promise<BrowserSession> {
    const start = Date.now();

    // Chrome can take a few seconds to open the debugging endpoint after spawn.
    while (Date.now() - start < timeout) {
      try {
        const browser = await chromium.connectOverCDP(config.chromeCdpUrl);
        const context = browser.contexts()[0] ?? (await browser.newContext());
        context.setDefaultTimeout(60_000);

        const notionPage =
          context.pages().find((page) => /notion\.(so|com)/i.test(page.url())) ??
          context.pages()[0] ??
          (await context.newPage());

        logger.info("Successfully connected to Chrome");
        return { context, page: notionPage, browser };
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    throw new Error(`Unable to connect to Chrome at ${config.chromeCdpUrl}`);
  }
}
