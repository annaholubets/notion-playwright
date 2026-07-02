import {Locator, Page} from "playwright";
import {WorkspaceMember} from "../types/workspace-member.js";
import {logger} from "../utils/logger.js";
import path from "node:path";
import {mkdir, writeFile} from "node:fs/promises";

export class NotionWorkspacePage {
  constructor(private readonly page: Page, private readonly outputDir: string) {}

  /**
   * Opens the workspace members tab, scrapes all visible and virtualized
   * members, saves, and returns the collected members
   */
  async fetchMembers(): Promise<WorkspaceMember[]> {
    const workspaceSettings = await this.navigateToMembersTab();
    const members = await this.scrapeMembers(workspaceSettings);
    await this.saveArtifacts(members);
    return members;
  }

  /**
   * Navigates through Notion settings to the People -> Members tab and returns
   * the dialog locator that contains the member list
   */
  private async navigateToMembersTab(): Promise<Locator> {
    logger.info("Navigating to Workspace Settings");
    await this.page.waitForURL(/notion\.(so|com)/, { timeout: 120_000 });

    await this.page.locator(".notion-sidebar-switcher").click();

    const workspaceMenu = this.page.locator(
      'div[role="dialog"]:has(.notranslate)'
    );
    await workspaceMenu.getByRole("button", { name: "Settings" }).click();

    const workspaceSettings = this.page.locator(
      'div[role="presentation"]:has([data-testid="settings-tab-user_settings"])'
    );
    await workspaceSettings.getByRole("tab", { name: "People" }).click();
    await workspaceSettings.getByRole("tab", { name: "Members" }).click();

    logger.info("Waiting for members list to render...");
    await workspaceSettings
      .getByText("User", { exact: true })
      .waitFor({ state: "visible", timeout: 15_000 });

    return workspaceSettings;
  }

  /**
   * Repeatedly collect visible rows and scroll until no new member appears
   */
  private async scrapeMembers(workspaceSettings: Locator): Promise<WorkspaceMember[]> {
    logger.info("Scraping members");

    const allMembers = new Map<string, WorkspaceMember>();
    let previousSize = 0;
    let noChangeCount = 0;
    const maxConsecutiveRetries = 3;

    while (noChangeCount < maxConsecutiveRetries) {
      const currentBatch = await workspaceSettings.evaluate(() => {
        const rows = document.querySelectorAll("div[data-index]");
        const parsed: { name: string; email: string; role: string }[] = [];

        rows.forEach((row) => {
          const emailDiv = row.querySelector('div[title*="@"]');
          if (!emailDiv) return;

          const email = emailDiv.getAttribute("title")?.trim() || "";
          if (!email || email.endsWith("@notion.so") || email.includes("noreply")) return;

          const nameDiv = row.querySelector('div[title]:not([title*="@"])');

          const name =
            nameDiv?.getAttribute("title")?.trim() ||
            email.split("@")[0] ||
            "Unknown";

          const role =
            row
              .querySelector('div[role="button"][aria-haspopup="dialog"] > span')
              ?.textContent
              ?.trim() || "Unknown";

          parsed.push({ name, email, role });
        });

        return parsed;
      });

      currentBatch.forEach(m => allMembers.set(m.email, m));

      if (allMembers.size === previousSize) {
        noChangeCount++;
      } else {
        noChangeCount = 0;
        previousSize = allMembers.size;
      }

      const lastRow = workspaceSettings.locator("div[data-index]").last();
      if (await lastRow.isVisible()) {
        await lastRow.scrollIntoViewIfNeeded();
        await this.page.waitForTimeout(400);
      } else {
        break;
      }
    }

    logger.info(`Total unique members found: ${allMembers.size}`);
    return Array.from(allMembers.values());
  }

  /**
   * Writes the scraped member list to JSON and captures a screenshot of the member page
   */
  private async saveArtifacts(members: WorkspaceMember[]): Promise<void> {
    await mkdir(this.outputDir, { recursive: true });

    const jsonPath = path.join(this.outputDir, "members.json");
    await writeFile(jsonPath, `${JSON.stringify(members, null, 2)}\n`, "utf8");
    logger.info(`Successfully saved ${members.length} members to JSON (in output directory: ${this.outputDir})`);
    console.table(members.slice(0, 3));

    const screenshotPath = path.join(this.outputDir, "members-page.png");
    await this.page.screenshot({ path: screenshotPath, fullPage: true });
    logger.info(`Screenshot saved to ${screenshotPath}`);
  }
}
