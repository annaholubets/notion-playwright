import {loadConfig} from "./config/env.js";
import {logger} from "./utils/logger.js";
import {BrowserSession} from "./types/browser-session.js";
import {ChromeManager} from "./browser/chrome-manager.js";
import {GoogleAuthService} from "./services/google-auth-service.js";
import {NotionWorkspacePage} from "./pages/notion-workspace-page.js";

async function main() {
  logger.info("Starting Task");

  const config = loadConfig();
  let session: BrowserSession | null = null;

  try {
    ChromeManager.spawnNative(config);
    session = await ChromeManager.connect(config);

    const { page } = session;

    const authService = new GoogleAuthService(config);
    const alreadyLoggedIn = await authService.isLoggedIn(page);

    if (alreadyLoggedIn) {
      logger.info("Already logged in! Skipping Google Auth flow");
    } else {
      logger.info("Not logged in. Triggering login flow");
      await authService.login(page);
    }

    const notionPage = new NotionWorkspacePage(page, config.outputDir);
    await notionPage.fetchMembers();

    logger.info("Scraping finished successfully");
  } catch (error) {
    logger.error({ err: error }, "An error occurred during execution");
    process.exitCode = 1;
  } finally {
    if (session) {
      logger.info("Disconnecting from browser");
      await session.browser.close().catch(() => null);
    }
  }
}

main();
