// press.js  (v3.3 – auto-find button across frames)
const { chromium } = require('@playwright/test');
const fs = require('fs');

const PANEL_BASE = 'https://gpanel.eternalzero.cloud';          // <— deine Panel-Domain
const LOGIN_URL = 'https://gpanel.eternalzero.cloud/auth/login'; // <-- anpassen
const APP_URL   = 'https://gpanel.eternalzero.cloud/server/675ad07f';   // <-- anpassen
////////////////////////////////////////////////////////////////////////////////

// ---- Selektor-Sammlungen ----------------------------------------------------
const USER_CANDIDATES = [
  'input[name="username"]',
  '#username',
  'input[type="text"]',
  'input:not([type])',
  'input[autocomplete="username"]',
  'input[placeholder*="user" i]',
  'input[aria-label*="user" i]'
];
const PASS_CANDIDATES = [
  'input[name="password"]',
  '#password',
  'input[type="password"]',
  'input[autocomplete="current-password"]',
  'input[placeholder*="pass" i]',
  'input[aria-label*="pass" i]'
];
const CONTINUE_CANDIDATES = [
  'button[type="submit"]',
  'input[type="submit"]',
  'button:has-text("Continue")',
  'button:has-text("Next")',
  'button:has-text("Weiter")',
  'button:has-text("Fortfahren")',
  'button:has-text("Login")',
  'button:has-text("Sign in")',
  'button:has-text("Anmelden")'
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

// Renew-Button (robust gegen Klassen-Hashes/Texte)
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
  'a:has-text("Keep Alive")','button:has-text("Keep Alive")'
];

// ---- Hilfsfunktionen --------------------------------------------------------
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

async function findFirst(ctx, selectors, timeout = 2500, allowAttached = true) {
  for (const sel of selectors) {
    try {
      const el = ctx.locator(sel).first();
      if (await el.isVisible({ timeout })) return el;
      if (allowAttached && await el.count().catch(()=>0)) return el; // im DOM, evtl. noch unsichtbar
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

// Sucht in Main + Frames (für Loginfelder oder Buttons)
async function findInAllContexts(page, selectors, opts = {}) {
  const { timeout = 2500, allowAttached = true } = opts;
  const ctxs = [page, ...page.frames().filter(f => f !== page.mainFrame())];
  for (const ctx of ctxs) {
    const el = await findFirst(ctx, selectors, timeout, allowAttached);
    if (el) return { ctx, el };
  }
  return null;
}

// Zwei-Schritt-Login: Username -> (Continue/Next) -> Passwort -> Submit
async function performLogin(page, context) {
  // Eventuelle Overlays/Cookie-Banner schließen
  await clickIfExists(page, OVERLAY_CLOSE_CANDIDATES);
  await clickIfExists(page, COOKIE_CANDIDATES);

  // 1) USERNAME suchen (auch ohne <form>)
  let uHit = await findInAllContexts(page, USER_CANDIDATES, { timeout: 5000 });
  if (!uHit) {
    console.log('ℹ️ Kein Username-Feld sichtbar.');
    await saveArtifacts(page, 'login-no-user');
    return false;
  }
  const { ctx: uctx, el: userEl } = uHit;

  // 2) PASSWORT schauen — evtl. bereits vorhanden?
  let pHit = await findInAllContexts(page, PASS_CANDIDATES, { timeout: 1500 });
  const alreadyHasPassword = !!pHit;

  // 3) Username füllen
  await userEl.fill(process.env.USER_EMAIL, { timeout: 15000 }).catch(()=>{});

  // 4) Falls Passwort noch nicht da: Continue/Next/Login drücken, oder Enter
  if (!alreadyHasPassword) {
    const cHit = await findInAllContexts(page, CONTINUE_CANDIDATES, { timeout: 1500, allowAttached: true });
    if (cHit) {
      await cHit.el.click({ timeout: 8000 }).catch(async ()=>{ await userEl.press('Enter'); });
    } else {
      await userEl.press('Enter').catch(()=>{});
    }
    await page.waitForTimeout(800);
  }

  // 5) Passwortfeld jetzt suchen (ggf. in Frames)
  pHit = await findInAllContexts(page, PASS_CANDIDATES, { timeout: 6000 });
  if (!pHit) {
    console.log('ℹ️ Passwortfeld nicht sichtbar.');
    await saveArtifacts(page, 'login-no-pass');
    return false;
  }
  const { ctx: pctx, el: passEl } = pHit;

  // 6) Passwort füllen
  await passEl.fill(process.env.USER_PASS, { timeout: 15000 }).catch(()=>{});

  // 7) Submit (Button/Enter)
  let sHit = await findInAllContexts(page, CONTINUE_CANDIDATES, { timeout: 2000 });
  if (sHit) {
    await sHit.el.click({ timeout: 8000 }).catch(async ()=>{ await passEl.press('Enter'); });
  } else {
    await passEl.press('Enter').catch(()=>{});
  }

  // 8) kurze Wartezeit & Session speichern
  await page.waitForTimeout(1200);
  await context.storageState({ path: 'auth.json' });
  console.log('💾 Session gespeichert');
  return true;
}

// ----------------------------- MAIN -----------------------------------------
(async () => {
  console.log('🚀 press.js v5.2 gestartet');

  const hasState = fs.existsSync('auth.json');
  const browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
  const context = await browser.newContext({
    storageState: hasState ? 'auth.json' : undefined,
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36'
  });
  const page = await context.newPage();

  try {
    await hardenAgainstAds(page);

    // === 1) Direkt zur Zielseite (falls Session aktiv) ===
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await clickIfExists(page, COOKIE_CANDIDATES);
    await clickIfExists(page, OVERLAY_CLOSE_CANDIDATES);

    let btn = await findFirst(page, BTN_CANDIDATES);

    // === 2) Login, wenn nötig (robust: ohne <form>, mit 2-Step, mit Frames) ===
    if (!btn) {
      await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
      const ok = await performLogin(page, context);
      if (!ok) {
        console.log('ℹ️ Kein sichtbares Login-Formular – Artefakte folgen.');
        await saveArtifacts(page, 'login-no-form');
        process.exit(0);
      }
      await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    }

    // === 3) Button suchen (mehrfach, Tabs öffnen, scrollen) ===
    console.log('🔎 Suche nach Button …');
    for (let i = 0; i < 6 && !btn; i++) {
      await clickIfExists(page, OVERLAY_CLOSE_CANDIDATES);
      await clickIfExists(page, BTN_OPENERS);
      await page.waitForTimeout(700);
      await page.mouse.wheel(0, 1800).catch(()=>{});
      await page.waitForTimeout(400);
      btn = await findFirst(page, BTN_CANDIDATES);
    }

    if (!btn) {
      // Diagnose-Dump
      const dump = await page.evaluate(() => {
        const pick = (el) => ({
          tag: el.tagName.toLowerCase(),
          text: (el.innerText || '').trim().slice(0,120),
          cls: (el.className || '').toString().slice(0,200),
          disabled: !!el.disabled,
          aria: el.getAttribute('aria-label') || '',
          id: el.id || ''
        });
        return {
          url: location.href,
          buttons: Array.from(document.querySelectorAll('button')).map(pick).slice(0,200),
          links:   Array.from(document.querySelectorAll('a')).map(pick).slice(0,200)
        };
      });
      fs.writeFileSync('dom-dump.json', JSON.stringify(dump, null, 2));
      console.log('ℹ️ Button nicht sichtbar – dom-dump.json erstellt. Artefakte folgen.');
      await saveArtifacts(page, 'no-button');
      process.exit(0);
    }

    // === 4) Status prüfen & klicken ===
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
