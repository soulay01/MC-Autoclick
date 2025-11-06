// press.js  (v3.3 – auto-find button across frames)
const { chromium } = require('@playwright/test');

const LOGIN_URL = 'https://gpanel.eternalzero.cloud/auth/login'; // <-- anpassen
const APP_URL   = 'https://gpanel.eternalzero.cloud/server/675ad07f';   // <-- anpassen
////////////////////////////////////////////////////////////////////////////////

// 🔎 Kandidaten für deinen Button (deiner ist hier gleich eingetragen)
const BTN_CANDIDATES = [
  'button.RenewBox__RenewButton-sc-1inh2rq-6',   // dein exakter Button
  '.RenewBox__RenewButton-sc-1inh2rq-6',
  'button.Button__ButtonStyle-sc-1qu1gou-0.RenewBox__RenewButton-sc-1inh2rq-6',
  'button:has-text("Renew")',
  'button:has-text("Extend")',
  'button:has-text("Keep Alive")',
  '[data-testid*="renew"]',
  '.renew-button'
];

const EMAIL_OPENERS = [
  'button:has-text("Continue with Email")','button:has-text("Sign in with Email")',
  'button:has-text("Login with Email")','button:has-text("Mit E-Mail")',
  'a:has-text("Mit E-Mail")','a:has-text("Continue with Email")'
];

const EMAIL_CANDIDATES = [
  'input[name="email"]','input#email','input[type="email"]',
  'input[name="username"]','input#username','input[name="identifier"]','input[name="emailAddress"]',
  'input[autocomplete="username"]','input[autocomplete="email"]',
  'input[placeholder*="E-Mail" i]','input[placeholder*="Email" i]','input[placeholder*="Mail" i]',
  'input[aria-label*="E-Mail" i]','input[aria-label*="Email" i]'
];
const PASS_CANDIDATES = [
  'input[name="password"]','input#password','input[type="password"]',
  'input[autocomplete="current-password"]','input[autocomplete="new-password"]',
  'input[placeholder*="Passwort" i]','input[placeholder*="Password" i]',
  'input[aria-label*="Passwort" i]','input[aria-label*="Password" i]'
];
const SUBMIT_CANDIDATES = [
  'button[type="submit"]','input[type="submit"]',
  'button:has-text("LOGIN")','button:has-text("Login")','button:has-text("Log in")','button:has-text("Anmelden")',
  '[data-testid="login-submit"]','button[aria-label*="Login" i]','button[aria-label*="Anmelden" i]'
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

////////////////////////////////////////////////////////////////////////////////

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
        await ctx.waitForTimeout(250);
        return true;
      }
    } catch {}
  }
  return false;
}

async function findFirst(ctx, selectors, timeout = 3500) {
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

////////////////////////////////////////////////////////////////////////////////

(async () => {
  console.log('🚀 press.js v3.3 gestartet');
  const browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
  const context = await browser.newContext({
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  try {
    await hardenAgainstAds(page);

    // Login-Seite
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await clickIfExists(page, COOKIE_CANDIDATES);
    await clickIfExists(page, OVERLAY_CLOSE_CANDIDATES);
    await clickIfExists(page, EMAIL_OPENERS);
    await page.waitForTimeout(400);

    // Login-Felder suchen
    const findField = async () => {
      let emailEl = await findFirst(page, EMAIL_CANDIDATES);
      let passEl  = await findFirst(page, PASS_CANDIDATES);
      let submitEl= await findFirst(page, SUBMIT_CANDIDATES);
      if (!emailEl || !passEl) {
        for (const frame of page.frames()) {
          if (frame === page.mainFrame()) continue;
          await clickIfExists(frame, OVERLAY_CLOSE_CANDIDATES);
          await clickIfExists(frame, COOKIE_CANDIDATES);
          await clickIfExists(frame, EMAIL_OPENERS);
          const e = await findFirst(frame, EMAIL_CANDIDATES);
          const p = await findFirst(frame, PASS_CANDIDATES);
          const s = await findFirst(frame, SUBMIT_CANDIDATES);
          if (e && p) return { ctx: frame, emailEl: e, passEl: p, submitEl: s };
        }
      }
      return { ctx: page, emailEl, passEl, submitEl };
    };

    const { ctx, emailEl, passEl, submitEl } = await findField();

    if (!emailEl || !passEl) {
      console.log('ℹ️ Keine Login-Felder gefunden (Overlay/SSO?). Artefakte folgen.');
      await saveArtifacts(page, 'login-no-fields');
      process.exit(0);
    }

    await emailEl.scrollIntoViewIfNeeded().catch(()=>{});
    await passEl.scrollIntoViewIfNeeded().catch(()=>{});
    await ctx.fill(await emailEl.selector(), process.env.USER_EMAIL, { timeout: 15000 });
    await ctx.fill(await passEl.selector(),  process.env.USER_PASS,  { timeout: 15000 });
    if (submitEl) await ctx.click(await submitEl.selector()).catch(() => ctx.press(await passEl.selector(), 'Enter'));
    else          await ctx.press(await passEl.selector(), 'Enter');
    await page.waitForTimeout(1200);

    // Button-Seite
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await clickIfExists(page, OVERLAY_CLOSE_CANDIDATES);
    await page.waitForTimeout(400);

    // Button suchen
    const findButton = async () => {
      let el = await findFirst(page, BTN_CANDIDATES, 3500);
      if (el) return { ctx: page, el };
      for (const frame of page.frames()) {
        if (frame === page.mainFrame()) continue;
        el = await findFirst(frame, BTN_CANDIDATES, 2500);
        if (el) return { ctx: frame, el };
      }
      return null;
    };

    let btnCtx = await findButton();
    if (!btnCtx) {
      await page.mouse.wheel(0, 2000).catch(()=>{});
      await page.waitForTimeout(500);
      btnCtx = await findButton();
    }

    if (!btnCtx) {
      console.log('ℹ️ Button nicht sichtbar – prüfe Kandidaten/Tabs/URL. Artefakte folgen.');
      await saveArtifacts(page, 'no-button');
      process.exit(0);
    }

    const { ctx: bctx, el: btn } = btnCtx;
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
