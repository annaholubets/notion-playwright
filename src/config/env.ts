import dotenv from "dotenv";

dotenv.config();

export type Config = {
  googleEmail?: string;
  googlePassword?: string;
  googleTotpSecret?: string;
  outputDir: string;
  browserProfileDir: string;
  chromeCdpUrl: string;
};

export function loadConfig(): Config {
  return {
    googleEmail: process.env.GOOGLE_EMAIL ?? '',
    googlePassword: process.env.GOOGLE_PASSWORD ?? '',
    googleTotpSecret: process.env.GOOGLE_TOTP_SECRET ?? '',
    outputDir: process.env.OUTPUT_DIR ?? "output",
    browserProfileDir: process.env.BROWSER_PROFILE_DIR ?? ".chrome-profile",
    chromeCdpUrl: process.env.CHROME_CDP_URL ?? "http://127.0.0.1:9222"
  };
}