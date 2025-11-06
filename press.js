// press.js  (v3.3 – auto-find button across frames)
const { chromium } = require('@playwright/test');

const LOGIN_URL = 'https://gpanel.eternalzero.cloud/auth/login'; // <-- anpassen
const APP_URL   = 'https://gpanel.eternalzero.cloud/server/675ad07f';   // <-- anpassen
////////////////////////////////////////////////////////////////////////////////

// Dein Button (plus ein paar Alternativen)
const BTN_CANDIDATES = [
  'button.RenewBox__RenewButton-sc-1inh2rq-6', // dein exakter Button
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
    if (html) require('fs').writeFileSync(`${label}.html`, html);
  } catch {}
}
async function clickIfExists(ctx, selectors, timeout = 2500) {
  for (const sel of selectors) {
    try {
      const el = ctx.locator(sel).first();
      if (await el.isVisible({ timeout })) { await el.click({ timeout }).catch(()=>{}); await ctx.waitForTimeout(250); return true; }
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
  const AD_HOST_HINTS = ['doubleclick','googlesyndication','adservice','adnxs','taboola','outbrain','googleads'];
  await page.route('**/*', route => {
    const url = route.request().url();
    if (AD_HOST_HINTS.some(h => url.includes(h))) return route.abort();
    return route.continue();
  });
  await page.addInitScript(() => {
    const kill = () => {
      const nuke = (sel) => document.querySelectorAll(sel).forEach(el => { try{ el.remove(); }catch{} });
      nuke('iframe[src*="ads"], iframe[id*="google"], [id^="google_ads"], [class*="ads"]');
      nuke('[role="dialog"], .modal, .overlay, .backdrop');
      [...document.querySelectorAll('body *')]
        .filter(el => Number(getComputedStyle(el).zIndex) > 9999)
        .forEach(el => el.style.display = 'none');
    };
    document.addEventListener('DOMContentLoaded', kill);
    setInterval(kill, 500);
  });
}

(async () => {
  console.log('🚀 press.js v3.3-fix3 gestartet');
  const browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
  const context = await browser.newContext({
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  try {
    await hardenAgainstAds(page);

    // 1) Login-Seite (DOM reicht), Overlays weg
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await clickIfExists(page, COOKIE_CANDIDATES);
    await clickIfExists(page, OVERLAY_CLOSE_CANDIDATES);
    await page.waitForTimeout(200);

    // 2) Formular-basiertes Matching: erstes sichtbares Formular
    const form = page.locator('form').filter({ has: page.locator('input') }).first();
    const formVisible = await form.isVisible({ timeout: 8000 }).catch(()=>false);

    if (!formVisible) {
      console.log('ℹ️ Kein sichtbares Login-Formular gefunden – Artefakte folgen.');
      await saveArtifacts(page, 'login-no-form');
      process.exit(0);
    }

    // 2a) E-Mail/Username-Feld = erstes sichtbares Text/Email/ohne-type-Input im Formular
    const emailEl = form.locator('input[type="email"], input[type="text"], input:not([type])').first();
    const passEl  = form.locator('input[type="password"]').first();
    const submitEl= form.getByRole('button', { name: /login/i }).first()
                      .or(form.locator('button[type="submit"], input[type="submit"]').first());

    const emailOk = await emailEl.isVisible().catch(()=>false);
    const passOk  = await passEl.isVisible().catch(()=>false);

    if (!emailOk || !passOk) {
      console.log('ℹ️ Eingabefelder nicht sichtbar – bitte Artifact prüfen.');
      await saveArtifacts(page, 'login-no-fields');
      process.exit(0);
    }

    await emailEl.fill(process.env.USER_EMAIL, { timeout: 15000 });
    await passEl.fill(process.env.USER_PASS,   { timeout: 15000 });
    if (await submitEl.isVisible().catch(()=>false)) {
      await submitEl.click().catch(async () => { await passEl.press('Enter'); });
    } else {
      await passEl.press('Enter').catch(()=>{});
    }
    await page.waitForTimeout(1000);

    // 3) Button-Seite (kein networkidle)
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await clickIfExists(page, OVERLAY_CLOSE_CANDIDATES);
    await page.waitForTimeout(300);

    // 4) Button suchen (main + frames), ggf. scrollen & retry
    const findButton = async () => {
      let el = await findFirst(page, BTN_CANDIDATES, 3500);
      if (el) return el;
      for (const frame of page.frames()) {
        if (frame === page.mainFrame()) continue;
        el = await findFirst(frame, BTN_CANDIDATES, 2500);
        if (el) return el;
      }
      return null;
    };

    let btn = await findButton();
    if (!btn) {
      await page.mouse.wheel(0, 2000).catch(()=>{});
      await page.waitForTimeout(400);
      btn = await findButton();
    }

    if (!btn) {
      console.log('ℹ️ Button nicht sichtbar – prüfe Kandidaten/Tabs/URL. Artefakte folgen.');
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
