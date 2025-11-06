// press.js  (v3.2 – block ads, dismiss overlays, robust login)
const { chromium } = require('@playwright/test');

const LOGIN_URL = 'https://gpanel.eternalzero.cloud/auth/login'; // <-- anpassen
const APP_URL   = 'https://gpanel.eternalzero.cloud/server/675ad07f';   // <-- anpassen
const BTN_SEL   = 'button.RenewBox__RenewButton-sc-1inh2rq-6';             // <-- anpassen
// ============================================================================

// Häufige Login-Fallstricke abfangen
const EMAIL_OPENERS = [
  'button:has-text("Continue with Email")',
  'button:has-text("Sign in with Email")',
  'button:has-text("Login with Email")',
  'button:has-text("Mit E-Mail")',
  'a:has-text("Mit E-Mail")',
  'a:has-text("Continue with Email")',
  '[data-testid*="email"][role="button"]'
];

// Kandidaten für Felder/Submit (DE/EN, verschiedenste UIs)
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

// Cookie-Banner & typische Overlay-Schließen-Buttons
const COOKIE_CANDIDATES = [
  'button:has-text("Accept")','button:has-text("I agree")',
  'button:has-text("Akzeptieren")','button:has-text("Alle akzeptieren")',
  '#onetrust-accept-btn-handler','button[aria-label="dismiss"]','button:has-text("OK")'
];
const OVERLAY_CLOSE_CANDIDATES = [
  '[aria-label="Close"]','button[aria-label="Close"]','.close','button:has-text("×")',
  'button:has-text("Schließen")','button:has-text("Close")','[role="dialog"] button'
];

// --- Utilities ---------------------------------------------------------------
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
        await ctx.waitForTimeout(300);
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

// ❌ Werbenetzwerke blocken + sichtbare Ad-Overlays entfernen
async function hardenAgainstAds(page) {
  const AD_HOST_HINTS = [
    'doubleclick', 'googlesyndication', 'adservice', 'adnxs', 'taboola', 'outbrain', 'googleads'
  ];
  await page.route('**/*', route => {
    const url = route.request().url();
    if (AD_HOST_HINTS.some(h => url.includes(h))) return route.abort();
    return route.continue();
  });
  // bereits geladene Overlays aus dem DOM schmeißen
  await page.addInitScript(() => {
    const kill = () => {
      const bad = [
        ...document.querySelectorAll('iframe[src*="ads"], iframe[id*="google"], [id^="google_ads"], [class*="ads"]'),
        ...document.querySelectorAll('[role="dialog"], .modal, .overlay, .backdrop')
      ];
      bad.forEach(el => { try { el.remove(); } catch(e){} });
      // pauschal: sehr hohe z-index-Overlays deaktivieren
      [...document.querySelectorAll('body *')]
        .filter(el => Number(getComputedStyle(el).zIndex) > 9999)
        .forEach(el => { el.style.display = 'none'; });
    };
    document.addEventListener('DOMContentLoaded', kill);
    setInterval(kill, 500);
  });
}

(async () => {
  console.log('🚀 press.js v3.2 gestartet');
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-dev-shm-usage']
  });
  const context = await browser.newContext({
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  try {
    // 1) Anti-Ad & Overlay-Härtung aktivieren
    await hardenAgainstAds(page);

    // 2) Login-Seite nur bis DOM geladen
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await clickIfExists(page, COOKIE_CANDIDATES).catch(() => {});
    await clickIfExists(page, OVERLAY_CLOSE_CANDIDATES).catch(() => {});
    await page.keyboard.press('Escape').catch(()=>{});
    await page.waitForTimeout(500);
    await clickIfExists(page, EMAIL_OPENERS).catch(() => {});

    // 3) Felder suchen (Main-DOM)
    let emailSel = await findFirst(page, EMAIL_CANDIDATES, 3000);
    let passSel  = await findFirst(page, PASS_CANDIDATES, 3000);
    let submitSel= await findFirst(page, SUBMIT_CANDIDATES, 1500);

    // 3a) Falls nicht gefunden: iFrames prüfen
    if (!emailSel || !passSel) {
      for (const frame of page.frames()) {
        if (frame === page.mainFrame()) continue;
        await clickIfExists(frame, OVERLAY_CLOSE_CANDIDATES).catch(() => {});
        await clickIfExists(frame, COOKIE_CANDIDATES).catch(() => {});
        await clickIfExists(frame, EMAIL_OPENERS).catch(() => {});
        const e = await findFirst(frame, EMAIL_CANDIDATES, 2000);
        const p = await findFirst(frame, PASS_CANDIDATES, 2000);
        const s = await findFirst(frame, SUBMIT_CANDIDATES, 1000);
        if (e && p) {
          await frame.fill(e, process.env.USER_EMAIL, { timeout: 15000 });
          await frame.fill(p, process.env.USER_PASS,  { timeout: 15000 });
          if (s) await frame.click(s).catch(() => frame.press(p, 'Enter'));
          else   await frame.press(p, 'Enter').catch(()=>{});
          await page.waitForTimeout(1200);
          emailSel = e; passSel = p; submitSel = s || null;
          break;
        }
      }
    }

    // 3b) Im Hauptdokument ausfüllen (falls dort gefunden)
    if (emailSel && passSel && !page.isClosed()) {
      await page.fill(emailSel, process.env.USER_EMAIL, { timeout: 15000 });
      await page.fill(passSel,  process.env.USER_PASS,  { timeout: 15000 });
      if (submitSel) await page.click(submitSel).catch(() => page.press(passSel, 'Enter'));
      else           await page.press(passSel, 'Enter').catch(()=>{});
      await page.waitForTimeout(1200);
    }

    // 3c) Falls gar nichts gefunden → Artefakte & GRÜN beenden
    if (!emailSel || !passSel) {
      console.log('ℹ️ Keine Login-Felder gefunden (Overlay/SSO?). Artefakte folgen.');
      await saveArtifacts(page, 'login-no-fields');
      process.exit(0);
    }

    // 4) Zur Button-Seite (kein networkidle)
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await clickIfExists(page, OVERLAY_CLOSE_CANDIDATES).catch(() => {});
    await page.waitForTimeout(400);

    // 5) Button suchen & ggf. klicken
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
