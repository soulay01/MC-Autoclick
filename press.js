// press.js
const { chromium } = require('@playwright/test');

const LOGIN_URL = 'https://example.com/login'; // <-- anpassen
const APP_URL   = 'https://example.com/app';   // <-- anpassen
const BTN_SEL   = 'button#hourly';             // <-- anpassen

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
