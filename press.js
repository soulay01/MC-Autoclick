// press.js
const { chromium } = require('@playwright/test');

const LOGIN_URL = 'https://gpanel.eternalzero.cloud/auth/login'; // <-- anpassen
const APP_URL   = 'https://gpanel.eternalzero.cloud/server/675ad07f';   // <-- anpassen
const BTN_SEL   = 'button.RenewBox__RenewButton-sc-1inh2rq-6';             // <-- anpassen
// ============================================================================

// Kandidaten-Felder: viele häufige Varianten (DE/EN, SSO)
const EMAIL_CANDIDATES = [
  // direkte
  'input[name="email"]',
  'input#email',
  'input[type="email"]',
  // alternative Namen
  'input[name="username"]',
  'input#username',
  'input[name="identifier"]',
  'input[name="emailAddress"]',
  // autocomplete
  'input[autocomplete="username"]',
  'input[autocomplete="email"]',
  // Platzhalter (DE/EN)
  'input[placeholder*="E-Mail" i]',
  'input[placeholder*="Email" i]',
  'input[placeholder*="Mail" i]',
  'input[aria-label*="E-Mail" i]',
  'input[aria-label*="Email" i]'
];

const PASS_CANDIDATES = [
  'input[name="password"]',
  'input#password',
  'input[type="password"]',
  'input[autocomplete="current-password"]',
  'input[autocomplete="new-password"]',
  'input[placeholder*="Passwort" i]',
  'input[placeholder*="Password" i]',
  'input[aria-label*="Passwort" i]',
  'input[aria-label*="Password" i]'
];

const SUBMIT_CANDIDATES = [
  'button[type="submit"]',
  'input[type="submit"]',
  'button:has-text("Login")',
  'button:has-text("Log in")',
  'button:has-text("Anmelden")',
  '[data-testid="login-submit"]',
  'button[aria-label*="Login" i]',
  'button[aria-label*="Anmelden" i]'
];

// Cookie Banner / Consent
const COOKIE_CANDIDATES = [
  'button:has-text("Accept")',
  'button:has-text("I agree")',
  'button:has-text("Akzeptieren")',
  'button:has-text("Alle akzeptieren")',
  '#onetrust-accept-btn-handler',
  'button[aria-label="dismiss"]',
  'button:has-text("OK")'
];

async function clickIfExists(pageOrFrame, selectors, timeout = 2000) {
  for (const sel of selectors) {
    try {
      const el = pageOrFrame.locator(sel).first();
      if (await el.isVisible({ timeout })) {
        await el.click({ timeout }).catch(() => {});
        return true;
      }
    } catch {}
  }
  return false;
}

async function findFirst(pageOrFrame, selectors, timeout = 3000) {
  for (const sel of selectors) {
    try {
      const loc = pageOrFrame.locator(sel).first();
      if (await loc.isVisible({ timeout })) return sel;
    } catch {}
  }
  return null;
}

async function saveArtifacts(page, label) {
  try {
    await page.screenshot({ path: `${label}.png`, fullPage: true }).catch(() => {});
    const html = await page.content().catch(() => '');
    if (html) require('fs').writeFileSync(`${label}.html`, html);
  } catch {}
}

(async () => {
  console.log('🔧 Robust login v2 gestartet');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // 1) Login-Seite laden
    await page.goto(LOGIN_URL, { waitUntil: 'networkidle', timeout: 60000 });

    // evtl. Consent schließen
    await clickIfExists(page, COOKIE_CANDIDATES).catch(() => {});

    // kleiner Delay, falls dynamisch
    await page.waitForTimeout(800);

    // 2) Felder im Hauptdokument suchen
    let emailSel = await findFirst(page, EMAIL_CANDIDATES, 3000);
    let passSel  = await findFirst(page, PASS_CANDIDATES, 3000);
    let submitSel= await findFirst(page, SUBMIT_CANDIDATES, 1500);

    // 2a) wenn nicht gefunden: iFrames durchsuchen (Auth0/Keycloak etc.)
    if (!emailSel || !passSel) {
      for (const frame of page.frames()) {
        if (frame === page.mainFrame()) continue;
        await clickIfExists(frame, COOKIE_CANDIDATES).catch(() => {});
        const e = await findFirst(frame, EMAIL_CANDIDATES, 2000);
        const p = await findFirst(frame, PASS_CANDIDATES, 2000);
        const s = await findFirst(frame, SUBMIT_CANDIDATES, 1000);
        if (e && p) {
          emailSel = `frame:${frame.url()}::${e}`;
          passSel  = `frame:${frame.url()}::${p}`;
          submitSel= s ? `frame:${frame.url()}::${s}` : null;
          break;
        }
      }
    }

    // 2b) wenn immer noch nicht gefunden: nochmal kurz warten & reload einmalig
    if (!emailSel || !passSel) {
      await page.waitForTimeout(1200);
      await page.reload({ waitUntil: 'networkidle' });
      await clickIfExists(page, COOKIE_CANDIDATES).catch(() => {});
      emailSel ||= await findFirst(page, EMAIL_CANDIDATES, 2000);
      passSel  ||= await findFirst(page, PASS_CANDIDATES, 2000);
      submitSel ||= await findFirst(page, SUBMIT_CANDIDATES, 1000);
    }

    // 2c) wenn trotz allem nichts: Artefakte speichern & GRÜN beenden
    if (!emailSel || !passSel) {
      console.log('ℹ️ Kein Login-Feld gefunden. Bitte Selektoren ergänzen. Artefakte werden hochgeladen.');
      await saveArtifacts(page, 'login-no-fields');
      process.exit(0);
    }

    // Hilfsfunktion: entweder im Frame oder Hauptseite agieren
    const act = async (sel, fn) => {
      if (sel.startsWith('frame:')) {
        const [, url, inner] = sel.match(/^frame:(.*)::(.*)$/);
        const frame = page.frames().find(f => f.url() === url);
        if (!frame) throw new Error('Frame nicht mehr verfügbar');
        return fn(frame, inner);
      }
      return fn(page, sel);
    };

    // 3) ausfüllen + submit
    await act(emailSel, async (ctx, sel) => ctx.fill(sel, process.env.USER_EMAIL, { timeout: 15000 }));
    await act(passSel,  async (ctx, sel) => ctx.fill(sel, process.env.USER_PASS,  { timeout: 15000 }));

    if (submitSel) {
      await Promise.all([
        act(submitSel, async (ctx, sel) => ctx.click(sel).catch(() => ctx.press(sel, 'Enter'))),
        page.waitForLoadState('networkidle', { timeout: 40000 }).catch(()=>{})
      ]);
    } else {
      // Enter auf Passwortfeld
      await act(passSel, async (ctx, sel) => ctx.press(sel, 'Enter'));
      await page.waitForLoadState('networkidle', { timeout: 40000 }).catch(()=>{});
    }

    // 4) Seite mit Button
    await page.goto(APP_URL, { waitUntil: 'networkidle', timeout: 60000 });

    // 5) Button suchen & Status prüfen
    const btn = page.locator(BTN_SEL).first();
    const visible = await btn.isVisible({ timeout: 8000 }).catch(() => false);
    if (!visible) {
      console.log('ℹ️ Button nicht sichtbar – prüfe BTN_SEL / APP_URL. Artefakte folgen.');
      await saveArtifacts(page, 'no-button');
      process.exit(0);
    }

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
