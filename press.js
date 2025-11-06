// press.js  (v3.3 – auto-find button across frames)
const { chromium } = require('@playwright/test');

const LOGIN_URL = 'https://gpanel.eternalzero.cloud/auth/login'; // <-- anpassen
const APP_URL   = 'https://gpanel.eternalzero.cloud/server/675ad07f';   // <-- anpassen
////////////////////////////////////////////////////////////////////////////////

// 🔎 Button-Kandidaten (deiner ist ganz oben)
const BTN_CANDIDATES = [
  'button.RenewBox__RenewButton-sc-1inh2rq-6',
  '.RenewBox__RenewButton-sc-1inh2rq-6',
  'button.Button__ButtonStyle-sc-1qu1gou-0.RenewBox__RenewButton-sc-1inh2rq-6',
  'button:has-text("Renew")',
  'button:has-text("Extend")',
  'button:has-text("Keep Alive")',
  '[data-testid*="renew"]',
  '.renew-button'
];

// Cookie-/Overlay-Buttons
const COOKIE_CANDIDATES = [
  'button:has-text("Accept")','button:has-text("I agree")',
  'button:has-text("Akzeptieren")','button:has-text("Alle akzeptieren")',
  '#onetrust-accept-btn-handler','button[aria-label="dismiss"]','button:has-text("OK")'
];
const OVERLAY_CLOSE_CANDIDATES = [
  '[aria-label="Close"]','button[aria-label="Close"]','.close','button:has-text("×")',
  'button:has-text("Schließen")','button:has-text("Close")','[role="dialog"] button'
];

// CSS-Backups
const EMAIL_CANDIDATES = [
  'input[name="email"]','input#email','input[type="email"]',
  'input[name="user"]','input#user','input[name="username"]','input#username',
  'input[name="identifier"]','input[name="emailAddress"]',
  'input[autocomplete="username"]','input[autocomplete="email"]'
];
const PASS_CANDIDATES = [
  'input[name="password"]','input#password','input[type="password"]',
  'input[autocomplete="current-password"]','input[autocomplete="new-password"]'
];
const SUBMIT_CANDIDATES = [
  'button[type="submit"]','input[type="submit"]',
  'button:has-text("LOGIN")','button:has-text("Login")','button:has-text("Log in")','button:has-text("Anmelden")'
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
  console.log('🚀 press.js v3.3-fix2 gestartet');
  const browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
  const context = await browser.newContext({
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  try {
    await hardenAgainstAds(page);

    // 1) Login-Seite öffnen (DOM reicht), Overlays schließen
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await clickIfExists(page, COOKIE_CANDIDATES);
    await clickIfExists(page, OVERLAY_CLOSE_CANDIDATES);
    await page.waitForTimeout(300);

    // 2) Pterodactyl: erst per Label/Role versuchen (robust)
    let emailEl = page.getByLabel(/username\s*or\s*email/i).first();
    let passEl  = page.getByLabel(/password/i).first();
    let submitEl= page.getByRole('button', { name: /login/i }).first();

    // Falls Label/Role nicht matchen → CSS-Kandidaten
    const emailVisible = await emailEl.isVisible().catch(()=>false);
    const passVisible  = await passEl.isVisible().catch(()=>false);
    if (!emailVisible || !passVisible) {
      emailEl = await findFirst(page, EMAIL_CANDIDATES) || emailEl;
      passEl  = await findFirst(page, PASS_CANDIDATES)  || passEl;
      submitEl= (await findFirst(page, SUBMIT_CANDIDATES)) || submitEl;
    }

    // Letzter Fallback: erstes Text/Email-Feld + Passwortfeld im gleichen Formular
    if (!(await emailEl.isVisible().catch(()=>false)) || !(await passEl.isVisible().catch(()=>false))) {
      const form = page.locator('form').first();
      const emailFallback = form.locator('input[type="email"], input[type="text"]').first();
      const passFallback  = form.locator('input[type="password"]').first();
      if (await emailFallback.isVisible().catch(()=>false) && await passFallback.isVisible().catch(()=>false)) {
        emailEl = emailFallback; passEl = passFallback;
      }
    }

    // Wenn immer noch nichts: Artefakte & grün raus
    if (!(await emailEl.isVisible().catch(()=>false)) || !(await passEl.isVisible().catch(()=>false))) {
      console.log('ℹ️ Login-Felder weiterhin nicht sichtbar – bitte Artifact prüfen (login-no-fields.html/png).');
      await saveArtifacts(page, 'login-no-fields');
      process.exit(0);
    }

    // Ausfüllen & submit
    await emailEl.fill(process.env.USER_EMAIL, { timeout: 15000 });
    await passEl.fill(process.env.USER_PASS,   { timeout: 15000 });
    if (await submitEl.isVisible().catch(()=>false)) {
      await submitEl.click().catch(async () => { await passEl.press('Enter'); });
    } else {
      await passEl.press('Enter').catch(()=>{});
    }
    await page.waitForTimeout(1200);

    // 3) Button-Seite
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await clickIfExists(page, OVERLAY_CLOSE_CANDIDATES);
    await page.waitForTimeout(300);

    // Button suchen (main + frames), ggf. scrollen & retry
    const findFirstEl = async () => {
      let el = await findFirst(page, BTN_CANDIDATES, 3500);
      if (el) return el;
      for (const frame of page.frames()) {
        if (frame === page.mainFrame()) continue;
        el = await findFirst(frame, BTN_CANDIDATES, 2500);
        if (el) return el;
      }
      return null;
    };

    let btn = await findFirstEl();
    if (!btn) {
      await page.mouse.wheel(0, 2000).catch(()=>{});
      await page.waitForTimeout(400);
      btn = await findFirstEl();
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
