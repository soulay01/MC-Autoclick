// press.js  (v3.3 – auto-find button across frames)
const { chromium } = require('@playwright/test');
const fs = require('fs');

const PANEL_BASE = 'https://gpanel.eternalzero.cloud';          // <— deine Panel-Domain
const LOGIN_URL = 'https://gpanel.eternalzero.cloud/auth/login'; // <-- anpassen
const APP_URL   = 'https://gpanel.eternalzero.cloud/server/675ad07f';   // <-- anpassen
////////////////////////////////////////////////////////////////////////////////

const BTN_CANDIDATES = [
  'button[class*="RenewBox__RenewButton"]',
  '[class*="RenewBox__RenewButton"]',
  'button:has-text("Renew")',
  'button:has-text("Extend")',
  'button:has-text("Keep Alive")',
  '[data-testid*="renew" i]',
  '[aria-label*="renew" i]',
  '.renew-button'
];

const BTN_OPENERS = [
  'a:has-text("Renew")','button:has-text("Renew")',
  'a:has-text("Extend")','button:has-text("Extend")',
  'a:has-text("Keep Alive")','button:has-text("Keep Alive")',
  '[data-testid*="renew" i]','[aria-controls*="renew" i]','[aria-label*="renew" i]'
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
    await page.screenshot({ path: `${label}.png`, fullPage: true }).catch(()=>{});
    const html = await page.content().catch(()=> '');
    if (html) fs.writeFileSync(`${label}.html`, html);
    console.log(`📎 Artefakte: ${label}.png/html`);
  } catch {}
}

async function clickIfExists(ctx, selectors, timeout = 2500) {
  for (const sel of selectors) {
    try {
      const el = ctx.locator(sel).first();
      if (await el.isVisible({ timeout })) {
        await el.click({ timeout }).catch(()=>{});
        await ctx.waitForTimeout(200);
        return true;
      }
    } catch {}
  }
  return false;
}

async function findFirst(ctx, selectors, timeout = 2500) {
  for (const sel of selectors) {
    try {
      const el = ctx.locator(sel).first();
      if (await el.isVisible({ timeout })) return el;
      if (await el.count().catch(()=>0)) return el; // im DOM, evtl. disabled
    } catch {}
  }
  return null;
}

async function hardenAgainstAds(page) {
  const BAD = ['doubleclick','googlesyndication','adservice','adnxs','taboola','outbrain','googleads'];
  await page.route('**/*', route => {
    const url = route.request().url();
    if (BAD.some(h => url.includes(h))) return route.abort();
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
  console.log('🚀 press.js v4-final gestartet');

  const hasState = fs.existsSync('auth.json');
  const browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
  const context = await browser.newContext({
    storageState: hasState ? 'auth.json' : undefined,
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  try {
    await hardenAgainstAds(page);

    // === LOGIN ===
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    console.log('➡️ Seite:', page.url());
    await clickIfExists(page, COOKIE_CANDIDATES);
    await clickIfExists(page, OVERLAY_CLOSE_CANDIDATES);

    // Button schon sichtbar? (Session gültig)
    let btn = await findFirst(page, BTN_CANDIDATES);
    if (!btn) {
      console.log('🔐 Login nötig');
      await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
      const form = page.locator('form').filter({ has: page.locator('input') }).first();
      const visible = await form.isVisible({ timeout: 8000 }).catch(()=>false);
      if (!visible) {
        console.log('ℹ️ Kein sichtbares Login-Formular.');
        await saveArtifacts(page, 'login-no-form');
        process.exit(0);
      }
      const userEl = form.locator('input[name="user"], input#user, input[type="email"], input[type="text"], input:not([type])').first();
      const passEl = form.locator('input[name="password"], input#password, input[type="password"]').first();
      const submitEl = form.locator('button[type="submit"], input[type="submit"], button:has-text("Login")').first();

      await userEl.fill(process.env.USER_EMAIL);
      await passEl.fill(process.env.USER_PASS);
      await submitEl.click().catch(async()=>{await passEl.press('Enter');});
      await page.waitForTimeout(1500);
      await context.storageState({ path: 'auth.json' });
      console.log('💾 Session gespeichert');
      await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    }

    // === BUTTON-SUCHE ===
    console.log('🔎 Suche nach Button ...');
    for (let i = 0; i < 6 && !btn; i++) {
      await clickIfExists(page, OVERLAY_CLOSE_CANDIDATES);
      await clickIfExists(page, BTN_OPENERS);
      await page.waitForTimeout(700);
      await page.mouse.wheel(0, 1800).catch(()=>{});
      await page.waitForTimeout(400);
      btn = await findFirst(page, BTN_CANDIDATES);
    }

    if (!btn) {
      console.log('ℹ️ Button nicht sichtbar – Artefakte folgen.');
      await saveArtifacts(page, 'no-button');
      process.exit(0);
    }

    await btn.scrollIntoViewIfNeeded().catch(()=>{});
    const disabledAttr = await btn.getAttribute('disabled').catch(()=>null);
    const isDisabled = disabledAttr !== null ? true : await btn.isDisabled().catch(()=>false);

    if (isDisabled) {
      console.log('⏳ Button ist gesperrt – Cooldown aktiv.');
      await saveArtifacts(page, 'disabled');
      process.exit(0);
    }

    await btn.click({ timeout: 10000 });
    console.log('✅ Button geklickt!');
    await saveArtifacts(page, 'clicked');

  } catch (err) {
    console.error('❌ Fehler:', err?.message || err);
    await saveArtifacts(page, 'error');
    process.exit(1);
  } finally {
    await browser.close().catch(()=>{});
  }
})();
