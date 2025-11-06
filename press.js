// press.js  (v3.3 – auto-find button across frames)
const { chromium } = require('@playwright/test');
const fs = require('fs');

const PANEL_BASE = 'https://gpanel.eternalzero.cloud';          // <— deine Panel-Domain
const LOGIN_URL = 'https://gpanel.eternalzero.cloud/auth/login'; // <-- anpassen
const APP_URL   = 'https://gpanel.eternalzero.cloud/server/675ad07f';   // <-- anpassen
////////////////////////////////////////////////////////////////////////////////

// Dein Button + Alternativen (deiner ganz oben)
const BTN_CANDIDATES = [
  // sehr robust: egal welcher Hash/Suffix
  'button[class*="RenewBox__RenewButton"]',
  '[class*="RenewBox__RenewButton"]',
  // text/aria/testid fallback
  'button:has-text("Renew")',
  'button:has-text("Extend")',
  'button:has-text("Keep Alive")',
  'button[aria-label*="renew" i]',
  '[data-testid*="renew" i]',
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
      // 3) Button-Seite (SPA: domcontentloaded reicht)
await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
console.log('➡️ Auf Seite:', page.url());

// Kandidaten, die evtl. zuerst geöffnet werden müssen (Sidebar/Tab/Box)
const BTN_OPENERS = [
  'a:has-text("Renew")', 'button:has-text("Renew")',
  'a:has-text("Extend")','button:has-text("Extend")',
  'a:has-text("Keep Alive")','button:has-text("Keep Alive")',
  '[data-testid*="renew" i]', '[aria-controls*="renew" i]', '[aria-label*="renew" i]'
];

const findButtonOnce = async () => {
  // 1) exakte Kandidaten durchsuchen (main + frames)
  const ctxs = [page, ...page.frames().filter(f => f !== page.mainFrame())];
  for (const ctx of ctxs) {
    for (const sel of BTN_CANDIDATES) {
      const el = ctx.locator(sel).first();
      if (await el.isVisible({ timeout: 600 }).catch(()=>false)) return el;
      // Falls erst im DOM, aber nicht sichtbar → trotzdem zurückgeben
      if (await el.count().catch(()=>0)) return el;
    }
  }
  return null;
};

// bis zu 6 Versuche: Overlays schließen, Opener klicken, warten, scrollen, suchen
let btn = null;
for (let attempt = 0; attempt < 6 && !btn; attempt++) {
  await clickIfExists(page, OVERLAY_CLOSE_CANDIDATES).catch(()=>{});
  await clickIfExists(page, BTN_OPENERS).catch(()=>{});

  // kleine Wartezeit für dynamische DOM-Updates
  await page.waitForTimeout(700);

  // versuche, dass der Button wenigstens "attached" ist (auch wenn noch nicht sichtbar)
  try {
    await page.waitForSelector('[class*="RenewBox__RenewButton"]', { state: 'attached', timeout: 1500 });
  } catch {}

  // scroll etwas, falls weiter unten
  await page.mouse.wheel(0, 1800).catch(()=>{});
  await page.waitForTimeout(300);

  btn = await findButtonOnce();
}

if (!btn) {
  // Diagnose: alle Buttons/Links dumpen
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
  require('fs').writeFileSync('dom-dump.json', JSON.stringify(dump, null, 2));
  console.log('ℹ️ Button nicht sichtbar – dom-dump.json erstellt. Artefakte folgen.');
  await saveArtifacts(page, 'no-button');
  process.exit(0);
}

// Status prüfen (sowohl via API als auch via disabled-Attribut)
await btn.scrollIntoViewIfNeeded().catch(()=>{});
const disabledAttr = await btn.getAttribute('disabled').catch(()=>null);
const isDisabled = disabledAttr !== null ? true : await btn.isDisabled().catch(() => true);

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
