# Notion Workspace Members

Browser automation that signs into Notion with Google, opens **Settings → Members**, and exports the workspace member list as JSON.

## Prerequisites

- Google Chrome installed
- A Notion workspace

## Setup

```bash
npm install
npx playwright install
cp .env.example .env
# Edit .env with your Google credentials
```

## Environment variables

- `GOOGLE_EMAIL` – Google account email (**REQUIRED**)
- `GOOGLE_PASSWORD` – Google account password (**REQUIRED**)
- `GOOGLE_TOTP_SECRET` – TOTP secret for Google 2FA (**OPTIONAL**)
- `BROWSER_PROFILE_DIR` – Chrome profile for CDP mode (**OPTIONAL**, default: `.chrome-profile`)
- `CHROME_CDP_URL` – CDP endpoint (**OPTIONAL**, default: `http://127.0.0.1:9222`)
- `OUTPUT_DIR` – Output directory (**OPTIONAL**, default: `output`)
- `CHROME_EXECUTABLE` – Path to Google Chrome executable (**OPTIONAL**)

## Run

```bash
npm start
```

Output:

- `output/members.json` — member list
- `output/members-page.png` — screenshot of the member page

Example output:

```json
[
  {
    "name": "Jane Doe",
    "email": "jane@example.com",
    "role": "Workspace owner"
  },
  {
    "name": "John Smith",
    "email": "john@example.com",
    "role": "Member"
  }
]
```

## What I learned

1. I found out that Google detects automation tools like Playwright. I needed to use a real Chrome browser, persistent profile, or manual login. I connected Playwright to a live Chrome session using CDP (connectOverCDP).
2. During Auth Flow, Google login has many branches (account chooser, password step, optional TOTP). I found a way to handle all of them with a single `await login()` function.
3. I needed incremental scrolling, stable selectors (div[data-index]), and other techniques to reliably collect all members without missing or duplicating rows, because the Notion is dynamic and virtualized.
4. Working with Playwright selectors in real apps requires a mix of semantic and structural locators. In general, I relied on role-based selectors (getByRole), text matching, and stable attributes (data-index, title) to make the automation more resilient to UI changes.
5. Many issues come from racing ahead of the UI (e.g., clicking “Next” before navigation finishes). I used explicit waits like waitForURL, waitForLoadState, and visibility checks to prevent race conditions and failures.
