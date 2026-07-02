import {Browser, BrowserContext, Page} from "playwright";

export type BrowserSession = {
  context: BrowserContext;
  page: Page;
  browser: Browser;
};