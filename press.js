// press.js  (v3.3 – auto-find button across frames)
const { chromium } = require('@playwright/test');
const fs = require('fs');

const PANEL_BASE = 'https://gpanel.eternalzero.cloud';          // <— deine Panel-Domain
const LOGIN_URL = 'https://gpanel.eternalzero.cloud/auth/login'; // <-- anpassen
const APP_URL   = 'https://gpanel.eternalzero.cloud/server/675ad07f';   // <-- anpassen
////////////////////////////////////////////////////////////////////////////////

// Dein Button + Alternativen (deiner ganz oben)
const BTN_CANDIDATES = [
  'button.RenewBox__RenewButton-sc-1inh2rq-6',
  '.RenewBox__RenewButton-sc-1inh2rq-6',
  'button:has-text("Renew")',
  'button:has-text("Extend")',
  'button:has-text("Keep Alive")',
  '[data-testid*="renew"]',
  '.renew-button'
];

const COOKIE_CANDIDATES = [
  'button:has-text("Accept")','button:has-text("I agree")',
  'button:has-text("Akzeptieren")','button:has-text("Alle akzeptieren")',
  '#onetrust-accept-btn-handler','button[aria-label="dismiss"]','button:has-text("OK")'
];
const OVERLAY_CLOSE_CANDIDATES = [
  '[aria-label="Close"]','button[aria-label="Close"]','.close','button:has-text("×")',
  'button:has-text("Schließen")','button:has-text("Close")','[role="dialog"] button'
];

async function saveArtifacts(page, label) {
  try {
    await page.screenshot({ path: `${label}.png`, fullPage: true }).catch(() => {});
    const html = await page.content().catch(() => '');
    if (html) fs.writeFileSync(`${label}.html`, html);
    console.log(`📎 Artefakte: ${label}.png/html`);
  } catch {}
}
async function clickIfExists(ctx, selectors, timeout = 2500) {
  for (const sel of selectors) {
    try {
      const el = ctx.locator(sel).first();
      if (await el.isVisible({ timeout })) {
        await el.click({ timeout }).catch(() => {});
        await ctx.waitForTimeout(200);
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
      if (await el.isVisible({ timeout })) return el;
    } catch {}
  }
  return null;
}
async function hardenAgainstAds(page) {
  const AD_HINTS = ['doubleclick','googlesyndication','adservice','adnxs','taboola','outbrain','googleads'];
  await page.route('**/*', route => {
    const url = route.request().url();
    if (AD_HINTS.some(h => url.includes(h))) return route.abort();
    return route.continue();
  });
  await page.addInitScript(() => {
    const kill = () => {
      const q = s => document.querySelectorAll(s).forEach(el => { try{ el.remove(); }catch{} });
      q('iframe[src*="ads"], iframe[id*="google"], [id^="google_ads"], [class*="ads"]');
      q('[role="dialog"], .modal, .overlay, .backdrop');
      [...document.querySelectorAll('body *')]
        .filter(el => Number(getComputedStyle(el).zIndex) > 9999)
        .forEach(el => el.style.display = 'none');
    };
    document.addEventListener('DOMContentLoaded', kill);
    setInterval(kill, 500);
  });
}

(async () => {
  console.log('🚀 press.js stable-login gestartet');
  const hasState = fs.existsSync('auth.json');

  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-dev-shm-usage']
  });

  // 👉 Session wiederverwenden, wenn vorhanden
  const context = await browser.newContext({
    storageState: hasState ? 'auth.json' : undefined,
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  });

  const page = await context.newPage();

  try {
    await hardenAgainstAds(page);

    // 1) Erst direkt zur Zielseite
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    console.log('➡️ Auf Seite:', page.url());
    await clickIfExists(page, OVERLAY_CLOSE_CANDIDATES);
    await clickIfExists(page, COOKIE_CANDIDATES);

    // Ist der Button schon sichtbar? (dann sind wir eingeloggt)
    let btn = await findFirst(page, BTN_CANDIDATES, 2500);
    if (!btn) {
      // 2) Login nötig → deterministischer Pterodactyl-Login
      console.log('🔐 Login nötig – gehe zu:', LOGIN_URL);
      await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
      console.log('➡️ Auf Seite:', page.url());
      await clickIfExists(page, OVERLAY_CLOSE_CANDIDATES);
      await clickIfExists(page, COOKIE_CANDIDATES);

      // Erstes sichtbares Formular
      const form = page.locator('form').filter({ has: page.locator('input') }).first();
      const formVisible = await form.isVisible({ timeout: 8000 }).catch(()=>false);
      if (!formVisible) {
        console.log('ℹ️ Kein sichtbares Login-Formular gefunden.');
        await saveArtifacts(page, 'login-no-form');
        process.exit(0);
      }

      // Pterodactyl hat üblicherweise name="user" und name="password"
      const userEl = form.locator('input[name="user"], input#user, input[type="email"], input[type="text"], input:not([type])').first();
      const passEl = form.locator('input[name="password"], input#password, input[type="password"]').first();
      const submitEl = form.getByRole('button', { name: /login/i }).first()
                       .or(form.locator('button[type="submit"], input[type="submit"]').first());

      const userOk = await userEl.isVisible().catch(()=>false);
      const passOk = await passEl.isVisible().catch(()=>false);
      if (!userOk || !passOk) {
        console.log('ℹ️ Login-Felder nicht sichtbar.');
        await saveArtifacts(page, 'login-no-fields');
        process.exit(0);
      }

      await userEl.fill(process.env.USER_EMAIL, { timeout: 15000 });
      await passEl.fill(process.env.USER_PASS,   { timeout: 15000 });

      if (await submitEl.isVisible().catch(()=>false)) {
        await submitEl.click().catch(async () => { await passEl.press('Enter'); });
      } else {
        await passEl.press('Enter').catch(()=>{});
      }

      // kurze Wartezeit & Session speichern
      await page.waitForTimeout(1200);
      await context.storageState({ path: 'auth.json' });   // <— Session auf Platte
      console.log('💾 Session gespeichert: auth.json');

      // zurück zur Zielseite
      await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
      console.log('➡️ Auf Seite:', page.url());
      await clickIfExists(page, OVERLAY_CLOSE_CANDIDATES);

      btn = await findFirst(page, BTN_CANDIDATES, 3000);
    }

    if (!btn) {
      console.log('ℹ️ Button nicht sichtbar – Artefakte folgen.');
      await saveArtifacts(page, 'no-button');
      process.exit(0);
    }

    await btn.scrollIntoViewIfNeeded().catch(()=>{});
    const disabled = await btn.isDisabled().catch(() => true);
    if (disabled) {
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
