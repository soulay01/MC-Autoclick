// press.js
const { chromium } = require('@playwright/test');

const LOGIN_URL = 'https://gpanel.eternalzero.cloud/auth/login'; // <-- anpassen
const APP_URL   = 'https://gpanel.eternalzero.cloud/server/675ad07f';   // <-- anpassen
const BTN_SEL   = 'button.RenewBox__RenewButton-sc-1inh2rq-6';             // <-- anpassen

// Mögliche Feld-Selektoren (häufige Varianten)
const EMAIL_CANDIDATES = [
  'input[name="email"]',
  'input#email',
  'input[name="username"]',
  'input#username',
  'input[type="email"]',
  'input[autocomplete="username"]'
];
const PASS_CANDIDATES = [
  'input[name="password"]',
  'input#password',
  'input[type="password"]',
  'input[autocomplete="current-password"]'
];
const SUBMIT_CANDIDATES = [
  'button[type="submit"]',
  'input[type="submit"]',
  'button:has-text("Login")',
  'button:has-text("Log in")',
  'button:has-text("Anmelden")',
  '[data-testid="login-submit"]'
];

// Häufige Cookie-Banner
const COOKIE_CANDIDATES = [
  'button:has-text("Accept")',
  'button:has-text("I agree")',
  'button:has-text("Akzeptieren")',
  'button:has-text("Alle akzeptieren")',
  '#onetrust-accept-btn-handler',
  'button[aria-label="dismiss"]'
];

async function clickIfExists(page, selectors, timeout = 2000) {
  for (const sel of selectors) {
    const el = page.locator(sel);
    if (await el.first().isVisible({ timeout }).catch(() => false)) {
      await el.first().click({ timeout }).catch(() => {});
      return true;
    }
  }
  return false;
}

async function findFirst(pageOrFrame, selectors, timeout = 5000) {
  for (const sel of selectors) {
    const loc = pageOrFrame.locator(sel);
    if (await loc.first().isVisible({ timeout }).catch(() => false)) {
      return sel;
    }
  }
  return null;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext(); // frische Session pro Lauf
  const page = await context.newPage();

  // 1) Login
  await page.goto(LOGIN_URL, { waitUntil: 'networkidle' });
  await page.fill('input[name="email"]', process.env.USER_EMAIL);
  await page.fill('input[name="password"]', process.env.USER_PASS);
  await Promise.all([
    page.click('button[type="submit"]'),
    page.waitForLoadState('networkidle')
  ]);

  // Optional: prüfen, ob Login wirklich geklappt hat (Titel/URL/Text prüfen)
  // if (!page.url().includes('/app')) { throw new Error('Login fehlgeschlagen'); }

  // 2) Seite mit Button öffnen
  await page.goto(APP_URL, { waitUntil: 'networkidle' });

  // 3) Button finden & Status prüfen
  const btn = page.locator(BTN_SEL);
  const visible = await btn.isVisible().catch(() => false);
  if (!visible) {
    throw new Error('Button nicht sichtbar – Selektor/Seite prüfen.');
  }

  const disabled = await btn.isDisabled().catch(() => true);

  if (disabled) {
    console.log('⏳ Button ist gesperrt – später wieder versuchen.');
  } else {
    await btn.click();
    // Optional: Erfolgsmeldung der Seite abwarten (Toast/Text/Status)
    // await page.waitForSelector('text=Erfolgreich', { timeout: 5000 }).catch(() => {});
    console.log('✅ Button geklickt');
  }

  await browser.close();
})().catch(err => {
  console.error('❌ Fehler:', err.message);
  process.exit(1);
});
