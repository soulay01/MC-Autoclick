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
  'button:has-text("Renew")','button:has-text("Extend")','button:has-text("Keep Alive")',
  '[data-testid*="renew" i]','[aria-label*="renew" i]','.renew-button'
];

const BTN_OPENERS = [
  'a:has-text("Renew")','button:has-text("Renew")',
  'a:has-text("Extend")','button:has-text("Extend")',
  'a:has-text("Keep Alive")','button:has-text("Keep Alive")'
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

async function findFirst(ctx, selectors, timeout = 2500, allowAttached = true) {
  for (const sel of selectors) {
    try {
      const el = ctx.locator(sel).first();
      if (await el.isVisible({ timeout })) return el;
      if (allowAttached && await el.count().catch(()=>0)) return el;
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

// --------- Login-Helfer: in Main + Frames umfassend suchen ------------------
async function enumerateFrames(page) {
  return [page, ...page.frames().filter(f => f !== page.mainFrame())];
}

function byPlaceholders(ctx) {
  return [
    ctx.getByPlaceholder(/user|benutzer|name|e.?mail/i).first(),
    ctx.getByPlaceholder(/pass|kennwort/i).first(),
  ];
}

function byLabels(ctx) {
  return [
    ctx.getByLabel(/user|benutzer|name|e.?mail/i).first(),
    ctx.getByLabel(/pass|kennwort/i).first(),
  ];
}

function byRoles(ctx) {
  return [
    ctx.getByRole('textbox').first(), // Username (erstes Textfeld)
    ctx.locator('input[type="password"]').first(),
  ];
}

function byCss(ctx) {
  const user = ctx.locator('input[name="username"], #username, input[autocomplete="username"], input[type="text"], input:not([type])').first();
  const pass = ctx.locator('input[name="password"], #password, input[autocomplete="current-password"], input[type="password"]').first();
  return [user, pass];
}

async function heuristicNeighbor(ctx) {
  // Suche nach Labeltext und nimm nahe Inputs
  const handle = await ctx.evaluateHandle(() => {
    const pick = (root, rx) => {
      const all = root.querySelectorAll('label, span, div, p');
      for (const el of all) {
        const t = (el.textContent || '').trim();
        if (rx.test(t)) {
          // nächster Input in den Nachbarn
          let n = el;
          for (let i=0; i<6 && n; i++) {
            n = n.nextElementSibling;
            if (!n) break;
            const inp = n.querySelector('input');
            if (inp) return inp;
          }
        }
      }
      return null;
    };
    const user = pick(document, /user|benutzer|name|e.?mail/i);
    const pass = pick(document, /pass|kennwort/i);
    return { user, pass };
  }).catch(()=>null);
  if (!handle) return [null, null];
  // Wir können nicht direkt aus dem Handle Playwright-Locators machen → erneut per CSS annähern:
  const userGuess = ctx.locator('label:has-text("user"), label:has-text("User"), :text("User") ~ input').first();
  const passGuess = ctx.locator('label:has-text("Pass"), label:has-text("pass"), :text("Pass") ~ input[type="password"]').first();
  return [userGuess, passGuess];
}

async function loginFindFields(page) {
  const contexts = await enumerateFrames(page);

  // 0) evtl. Tabs "Username/E-Mail" oder "Login/Sign in" öffnen
  for (const ctx of contexts) {
    await clickIfExists(ctx, [
      'button:has-text("Username")','a:has-text("Username")',
      'button:has-text("E-Mail")','a:has-text("E-Mail")',
      'button:has-text("Mit Benutzername")','button:has-text("Mit E-Mail")'
    ], 1200);
  }

  // 1) Placeholder
  for (const ctx of contexts) {
    const [u, p] = byPlaceholders(ctx);
    if (await u.isVisible().catch(()=>false) && await p.isVisible().catch(()=>false)) return { ctx, user: u, pass: p };
  }
  // 2) Label
  for (const ctx of contexts) {
    const [u, p] = byLabels(ctx);
    if (await u.isVisible().catch(()=>false) && await p.isVisible().catch(()=>false)) return { ctx, user: u, pass: p };
  }
  // 3) CSS
  for (const ctx of contexts) {
    const [u, p] = byCss(ctx);
    if (await u.isVisible().catch(()=>false) && await p.isVisible().catch(()=>false)) return { ctx, user: u, pass: p };
  }
  // 4) Role/Fallback
  for (const ctx of contexts) {
    const [u, p] = byRoles(ctx);
    if (await u.isVisible().catch(()=>false) && await p.isVisible().catch(()=>false)) return { ctx, user: u, pass: p };
  }
  // 5) Heuristik (Nachbar von Text)
  for (const ctx of contexts) {
    const [u, p] = await heuristicNeighbor(ctx);
    if (u && p && await u.isVisible().catch(()=>false) && await p.isVisible().catch(()=>false)) return { ctx, user: u, pass: p };
  }

  return null;
}

async function dumpLogin(page, label = 'login-dump') {
  try {
    const frames = page.frames().map(f => ({ url: f.url() }));
    const bodyText = await page.evaluate(() => document.body ? document.body.innerText.slice(0, 2000) : '');
    const inputs = await page.evaluate(() => {
      const pick = (el) => ({
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute('type') || '',
        name: el.getAttribute('name') || '',
        id: el.id || '',
        placeholder: el.getAttribute('placeholder') || '',
        aria: el.getAttribute('aria-label') || '',
        cls: (el.className || '').toString().slice(0,150)
      });
      return Array.from(document.querySelectorAll('input')).map(pick).slice(0,300);
    }).catch(()=>[]);
    fs.writeFileSync(`${label}.json`, JSON.stringify({ url: page.url(), frames, bodyText, inputs }, null, 2));
    console.log(`📄 Diagnose geschrieben: ${label}.json`);
  } catch {}
}

// ----------------------------- MAIN -----------------------------------------
(async () => {
  console.log('🚀 press.js v6.3 gestartet');

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

    // 1) Direkt Zielseite (falls Session aktiv)
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await clickIfExists(page, COOKIE_CANDIDATES);
    await clickIfExists(page, OVERLAY_CLOSE_CANDIDATES);

    let btn = await findFirst(page, BTN_CANDIDATES);
    if (!btn) {
      // 2) Login-Flow
      await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await clickIfExists(page, OVERLAY_CLOSE_CANDIDATES);
      await clickIfExists(page, COOKIE_CANDIDATES);
      await page.waitForTimeout(400);

      // Öffne ggf. Tabs "Username" o. ä.
      await clickIfExists(page, [
        'button:has-text("Username")','a:has-text("Username")',
        'button:has-text("E-Mail")','a:has-text("E-Mail")',
        'button:has-text("Benutzername")'
      ]);

      const fields = await loginFindFields(page);

      if (!fields) {
        console.log('ℹ️ Login-Felder nicht sichtbar – Diagnose folgt.');
        await dumpLogin(page, 'login-dump');
        await saveArtifacts(page, 'login-no-form');
        process.exit(0);
      }

      const { ctx, user, pass } = fields;
      await user.fill(process.env.USER_EMAIL, { timeout: 15000 }).catch(()=>{});
      await pass.fill(process.env.USER_PASS,   { timeout: 15000 }).catch(()=>{});

      // Submit: Button oder Enter
      const submit =
        (await findFirst(ctx, [
          'button[type="submit"]','input[type="submit"]',
          'button:has-text("Login")','button:has-text("Sign in")','button:has-text("Anmelden")',
          'button:has-text("Weiter")','button:has-text("Continue")','button:has-text("Next")'
        ], 2000)) || null;

      if (submit) {
        await submit.click().catch(async ()=>{ await pass.press('Enter'); });
      } else {
        await pass.press('Enter').catch(()=>{});
      }

      await page.waitForTimeout(1500);
      await context.storageState({ path: 'auth.json' }); // Session speichern
      await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    }

    // 3) Button finden & klicken
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
      // Diagnose der Zielseite
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
      console.log('ℹ️ Button nicht sichtbar – dom-dump.json erstellt.');
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
    await dumpLogin(page, 'login-dump-error');
    await saveArtifacts(page, 'error');
    process.exit(1);
  } finally {
    await browser.close().catch(()=>{});
  }
})();
