// press.js
const { chromium } = require('@playwright/test');

const LOGIN_URL = 'https://gpanel.eternalzero.cloud/auth/login'; // <-- anpassen
const APP_URL   = 'https://gpanel.eternalzero.cloud/server/675ad07f';   // <-- anpassen
const BTN_SEL   = 'button.RenewBox__RenewButton-sc-1inh2rq-6';             // <-- anpassen
// ============================================================================

const EMAIL_OPENERS = [
  // Knöpfe/Links, die erst das E-Mail-Formular aufklappen
  'button:has-text("Continue with Email")',
  'button:has-text("Sign in with Email")',
  'button:has-text("Login with Email")',
  'button:has-text("Mit E-Mail")',
  'button:has-text("E-Mail")',
  'a:has-text("Mit E-Mail")',
  'a:has-text("Continue with Email")',
  '[data-testid*="email"][role="button"]'
];

const EMAIL_CANDIDATES = [
  'input[name="email"]', 'input#email', 'input[type="email"]',
  'input[name="username"]', 'input#username', 'input[name="identifier"]', 'input[name="emailAddress"]',
  'input[autocomplete="username"]', 'input[autocomplete="email"]',
  'input[placeholder*="E-Mail" i]', 'input[placeholder*="Email" i]', 'input[placeholder*="Mail" i]',
  'input[aria-label*="E-Mail" i]', 'input[aria-label*="Email" i]'
];

const PASS_CANDIDATES = [
  'input[name="password"]', 'input#password', 'input[type="password"]',
  'input[autocomplete="current-password"]', 'input[autocomplete="new-password"]',
  'input[placeholder*="Passwort" i]', 'input[placeholder*="Password" i]',
  'input[aria-label*="Passwort" i]', 'input[aria-label*="Password" i]'
];

const SUBMIT_CANDIDATES = [
  'button[type="submit"]', 'input[type="submit"]',
  'button:has-text("Login")', 'button:has-text("Log in")', 'button:has-text("Anmelden")',
  '[data-testid="login-submit"]', 'button[aria-label*="Login" i]', 'button[aria-label*="Anmelden" i]'
];

const COOKIE_CANDIDATES = [
  'button:has-text("Accept")', 'button:has-text("I agree")',
  'button:has-text("Akzeptieren")', 'button:has-text("Alle akzeptieren")',
  '#onetrust-accept-btn-handler', 'button[aria-label="dismiss"]', 'button:has-text("OK")'
];

async function saveArtifacts(page, label) {
  try {
    await page.screenshot({ path: `${label}.png`, fullPage: true }).catch(() => {});
    const html = await page.content().catch(() => '');
    if (html) require('fs').writeFileSync(`${label}.html`, html);
  } catch {}
}

async function clickIfExists(ctx, selectors, timeout = 2500) {
  for (const sel of selectors) {
    try {
      const el = ctx.locator(sel).first();
      if (await el.isVisible({ timeout })) {
        await el.click({ timeout }).catch(() => {});
        await ctx.waitForLoadState('networkidle').catch(() => {});
        return true;
      }
    } catch {}
  }
  return false;
}

async function findFirst(ctx, selectors, timeout = 3000) {
  for (const sel of selectors) {
    try {
      const el = ctx.locator(sel).first();
      if (await el.isVisible({ timeout })) return sel;
    } catch {}
  }
  return null;
}

(async () => {
  console.log('🚀 press.js v3 gestartet');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // 1) Login-Seite
    await page.goto(LOGIN_URL, { waitUntil: 'networkidle', timeout: 60000 });
    await clickIfExists(page, COOKIE_CANDIDATES).catch(() => {});
    await page.waitForTimeout(600);

    // 2) E-Mail-Login ggf. erst "öffnen"
    await clickIfExists(page, EMAIL_OPENERS).catch(() => {});

    // 3) Felder suchen (Hauptdokument)
    let emailSel = await findFirst(page, EMAIL_CANDIDATES, 3000);
    let passSel  = await findFirst(page, PASS_CANDIDATES, 3000);
    let submitSel= await findFirst(page, SUBMIT_CANDIDATES, 1500);

    // 3a) Falls nicht gefunden: iFrames durchsuchen
    if (!emailSel || !passSel) {
      for (const frame of page.frames()) {
        if (frame === page.mainFrame()) continue;
        await clickIfExists(frame, COOKIE_CANDIDATES).catch(() => {});
        await clickIfExists(frame, EMAIL_OPENERS).catch(() => {});
        const e = await findFirst(frame, EMAIL_CANDIDATES, 2000);
        const p = await findFirst(frame, PASS_CANDIDATES, 2000);
        const s = await findFirst(frame, SUBMIT_CANDIDATES, 1000);
        if (e && p) {
          // innerhalb des Frames arbeiten
          await frame.fill(e, process.env.USER_EMAIL, { timeout: 15000 });
          await frame.fill(p, process.env.USER_PASS,  { timeout: 15000 });
          if (s) {
            await Promise.all([
              frame.click(s).catch(() => frame.press(p, 'Enter')),
              page.waitForLoadState('networkidle', { timeout: 40000 }).catch(()=>{})
            ]);
          } else {
            await frame.press(p, 'Enter').catch(()=>{});
            await page.waitForLoadState('networkidle', { timeout: 40000 }).catch(()=>{});
          }
          emailSel = e; passSel = p; submitSel = s; // Marker, dass wir eingeloggt haben
          break;
        }
      }
    }

    // 3b) Wenn im Hauptdokument gefunden: ausfüllen
    if (emailSel && passSel && !page.isClosed()) {
      await page.fill(emailSel, process.env.USER_EMAIL, { timeout: 15000 });
      await page.fill(passSel,  process.env.USER_PASS,  { timeout: 15000 });
      if (submitSel) {
        await Promise.all([
          page.click(submitSel).catch(() => page.press(passSel, 'Enter')),
          page.waitForLoadState('networkidle', { timeout: 40000 }).catch(()=>{})
        ]);
      } else {
        await page.press(passSel, 'Enter').catch(()=>{});
        await page.waitForLoadState('networkidle', { timeout: 40000 }).catch(()=>{});
      }
    }

    // Wenn gar keine Felder gefunden → Screenshot & GRÜN beenden (Cron versucht später erneut)
    if (!emailSel || !passSel) {
      console.log('ℹ️ Keine Login-Felder gefunden (evtl. SSO/anderer Flow). Artefakte folgen.');
      await saveArtifacts(page, 'login-no-fields');
      process.exit(0);
    }

    // 4) Seite mit Button
    await page.goto(APP_URL, { waitUntil: 'networkidle', timeout: 60000 });

    // 5) Button suchen/klicken
    const btn = page.locator(BTN_SEL).first();
    const isVisible = await btn.isVisible({ timeout: 8000 }).catch(() => false);
    if (!isVisible) {
      console.log('ℹ️ Button nicht sichtbar – prüfe BTN_SEL / APP_URL.');
      await saveArtifacts(page, 'no-button');
      process.exit(0);
    }

    const isDisabled = await btn.isDisabled().catch(() => true);
    if (isDisabled) {
      console.log('⏳ Button ist gesperrt – später wieder versuchen.');
      await saveArtifacts(page, 'disabled');
      process.exit(0);
    }

    await btn.click({ timeout: 10000 });
    console.log('✅ Button geklickt');
    await saveArtifacts(page, 'clicked');

  } catch (err) {
    console.error('❌ Unerwarteter Fehler:', err?.message || err);
    await saveArtifacts(page, 'error');
    process.exit(1);
  } finally {
    await browser.close().catch(() => {});
  }
})();
