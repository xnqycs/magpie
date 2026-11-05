// The reporter's OpenCode Go layout: 5 hours, week and month on eight
// accounts. Each account owns its meters and details; the provider's
// remaining total is independent of Used / Left and includes folded rows.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { test } = require("node:test");
const { chromium, webkit } = require("playwright");
const assets = path.resolve(__dirname, process.env.MAGPIE_QUOTA_ASSETS || "../assets");
const words = {
  en: ["Total remaining", "full-account allowances", "Month: 6% left"],
  zh: ["总剩余", "个满额账号额度", "本月：剩余 6%"],
  "zh-TW": ["總剩餘", "個滿額帳號額度", "本月：剩餘 6%"],
  ja: ["残りの合計", "アカウント満額分", "今月：残り 6%"],
  de: ["Insgesamt übrig", "volle Kontingente", "Monat: 6% übrig"],
};
function fixture(lang, theme, readings) {
  const now = Date.now(), at = (h) => new Date(now + h * 3600e3).toISOString();
  const weeks = [100, 99, 100, 62, 27, 8, 6, 7], months = [6, 9, 10, 9, 7, 10, 31, 47];
  const settings = { lang, theme, quotaLeft: true, currency: "usd" };
  const quotas = readings || weeks.map((week, i) => ({ provider: "opencode-go", name: "OpenCode Go", kind: "plan", icon: "generic", user: "oc_s…" + ["EZgR", "Mvjj", "erl2", "kkiu", "9x9Y", "oRiC", "3Uvx", "8HwR"][i], readAt: at(0), windows: [
    { name: "5 hours", used: 0 }, { name: "7 days", used: 100 - week, resetsAt: at(100) }, { name: "Month", used: 100 - months[i], resetsAt: at(300) },
  ] }));
  return async (r) => {
    const req = r.request(), url = new URL(req.url()), json = (data) => r.fulfill({ json: data });
    if (url.pathname === "/boot.js") return r.fulfill({ contentType: "text/javascript", body: `window.bootPrefs = ${JSON.stringify({ lang, theme, web: true })};` });
    if (url.pathname === "/wails/runtime.js") return r.fulfill({ contentType: "text/javascript", body: "export const Window = {};" });
    if (url.pathname === "/api/state") return json({ agents: [], profiles: [], settings });
    if (url.pathname === "/api/settings") return json(settings);
    if (url.pathname === "/api/settings/quota-left") { settings.quotaLeft = req.postDataJSON().on; return json(settings); }
    if (url.pathname === "/api/usage/arrange") { settings.usageCardsHidden = req.postDataJSON().cardsHidden; return json(settings); }
    if (url.pathname === "/api/providers") return json({ providers: [], presets: [], excluded: [], gateway: { running: true, window: true } });
    if (url.pathname === "/api/usage/quotas") return json(quotas);
    if (url.pathname === "/api/usage/quotas/refresh") {
      const q = quotas.find((q) => q.user === url.searchParams.get("user"));
      q.windows[2].used = 85;
      return json([q]);
    }
    if (url.pathname === "/api/groups") return json({ groups: [], models: [] });
    if (url.pathname === "/api/plugins") return json({ plugins: [] });
    if (url.pathname.startsWith("/api/")) return json({});
    const file = path.join(assets, url.pathname === "/" ? "index.html" : url.pathname);
    try { await r.fulfill({ body: await fs.readFile(file), contentType: { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" }[path.extname(file)] }); }
    catch { await r.fulfill({ status: 404, body: "" }); }
  };
}
for (const engine of process.env.BROWSER ? [process.env.BROWSER] : ["chromium", "webkit"]) {
  for (const lang of Object.keys(words)) for (const theme of ["light", "dark"]) {
    test(`${engine} ${lang} ${theme}: independent account cards and remaining totals`, async (t) => {
      const browser = await (engine === "webkit" ? webkit.launch() : chromium.launch({ channel: "chromium" }));
      t.after(() => browser.close());
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
      page.setDefaultTimeout(5000);
      page.setDefaultNavigationTimeout(60000);
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.route("**/*", fixture(lang, theme));
      await page.addInitScript(() => localStorage.setItem("magpie.quotaRange", "off"));
      await page.goto("http://magpie.test/?view=usage");
      const summary = page.locator(".quota-overview"), cards = page.locator(".quota-account-card");
      await summary.waitFor();
      assert.equal(await cards.count(), 8);
      assert((await summary.innerText()).includes(words[lang][0]));
      assert(!(await summary.innerText()).includes(words[lang][1]), "no full-account equivalents");
      assert.deepEqual(await summary.locator(".quota-total-name").allTextContents(), ["5h", "7d", "30d"]);
      assert.deepEqual(await summary.locator(".quota-total-value").allTextContents(), ["100%", "51.13%", "16.13%"]);
      const rings = summary.getByRole("meter");
      assert.equal(await rings.count(), 3);
      for (const [i, value] of [100, 51.125, 16.125].entries()) {
        assert(Math.abs(Number(await rings.nth(i).getAttribute("aria-valuenow")) - value) < 1e-8);
        assert.equal(await rings.nth(i).getAttribute("aria-valuemin"), "0");
        assert.equal(await rings.nth(i).getAttribute("aria-valuemax"), "100");
      }
      assert.equal(await cards.first().locator(".quota-account-state").textContent(), words[lang][2]);
      const original = await summary.innerText();
      for (const width of [1920, 1440, 390, 320]) {
        await page.setViewportSize({ width, height: width <= 390 ? 900 : 1000 });
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await page.waitForFunction(() => [...document.querySelectorAll(".quota-live")].every((e) => e.classList.contains("quota-stack") === (e.clientWidth < 250)));
        if (width === 1920) {
          const inFirstRow = await cards.evaluateAll((cs) => cs.filter((c) => Math.abs(c.getBoundingClientRect().top - cs[0].getBoundingClientRect().top) < 1).length);
          assert.equal(inFirstRow, 4, "wide rows hold four accounts");
          assert((await cards.nth(4).boundingBox()).y > (await cards.first().boundingBox()).y, "wide rows hold four accounts");
        }
        if (width === 1440 && lang === "zh") assert((await cards.first().boundingBox()).height < 215, "three-period account cards stay compact");
        const bad = await cards.evaluateAll((cs) => cs.flatMap((c) => {
          const b = c.getBoundingClientRect(), bad = [];
          if (c.scrollWidth > c.clientWidth + 1) bad.push("card overflow");
          for (const q of c.querySelectorAll(".quota-live > .quota, .subscription-account, .quota-read, .quota-account-details")) {
            if (!q.offsetParent) continue;
            const r = q.getBoundingClientRect();
            if (r.left < b.left || r.right > b.right + 1 || r.bottom > b.bottom + 1) bad.push("outside own card: " + q.className);
          }
          for (const q of c.querySelectorAll(".quota-live > .quota")) {
            const r = q.getBoundingClientRect();
            for (const text of q.querySelectorAll(".quota-name, .quota-n, .quota-n > span")) {
              const t = text.getBoundingClientRect();
              if (t.left < r.left - 1 || t.right > r.right + 1 || text.scrollWidth > text.clientWidth + 1) bad.push("meter text crosses its own column");
            }
          }
          const ms = [...c.querySelectorAll(".quota-live > .quota")].map((q) => q.getBoundingClientRect());
          if (!c.querySelector(".quota-stack") && ms.some((m) => Math.abs(m.top - ms[0].top) > 1)) bad.push("three periods split into rows");
          return bad;
        }));
        assert.deepEqual(bad, []);
        assert.deepEqual(await rings.evaluateAll((rs) => rs.flatMap((ring) => {
          const r = ring.getBoundingClientRect(), v = ring.querySelector(".quota-total-value").getBoundingClientRect();
          const bad = [];
          if (Math.abs(r.width - r.height) > 1) bad.push(`ring isn't circular: ${r.width} × ${r.height}`);
          if (v.left < r.left + 6 || v.right > r.right - 6) bad.push("percentage crosses ring");
          if (ring.scrollWidth > ring.clientWidth + 1) bad.push("ring overflows");
          if (!getComputedStyle(ring).backgroundImage.includes("conic-gradient")) bad.push("ring isn't drawn");
          return bad;
        })), []);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        if (process.env.ARTIFACT_DIR && lang === "zh") {
          await fs.mkdir(process.env.ARTIFACT_DIR, { recursive: true });
          await page.screenshot({ path: path.join(process.env.ARTIFACT_DIR, `usage-${engine}-${theme}-${width}.png`) });
        }
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.locator("#quotaMode button").first().click();
      await page.waitForFunction(() => document.querySelector("#quotaMode button").classList.contains("on"));
      assert.equal(await summary.innerText(), original, "Used leaves remaining totals alone");
      assert((await cards.first().locator(".quota-live .quota-n").last().textContent()).includes("94%"));
      assert.equal(await cards.first().locator(".quota-account-state").textContent(), words[lang][2], "health is always remaining");
      await cards.nth(1).locator(".quota-acct-fold").click();
      assert.equal(await cards.nth(1).locator(".quota-acct-fold").getAttribute("aria-expanded"), "true");
      assert.equal(await cards.nth(2).locator(".quota-acct-fold").getAttribute("aria-expanded"), "false");
      await cards.first().locator(".quota-refresh").first().click();
      await page.waitForFunction(() => document.querySelector(".quota-overview .quota-total:last-child .quota-total-value").textContent === "17.25%");
      assert((await cards.nth(1).locator(".quota-live .quota-n").last().textContent()).includes("91%"), "refresh didn't change neighbor");
      await cards.nth(1).locator(".quota-live").click({ button: "right" });
      await page.locator(".row-menu button").first().click();
      await page.waitForFunction(() => document.querySelectorAll(".quota-account-card").length === 7);
      assert((await cards.first().innerText()).includes("EZgR"), "hide targeted the clicked account");
      assert.deepEqual(await summary.locator(".quota-total-value").allTextContents(), ["100%", "44.29%", "18.43%"]);
      assert.deepEqual(errors, []);
    });
  }
  test(`${engine}: remaining rings distinguish empty, tiny, partial and stale readings`, async (t) => {
    const browser = await (engine === "webkit" ? webkit.launch() : chromium.launch({ channel: "chromium" }));
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 390, height: 900 }, reducedMotion: "reduce" });
    const base = { provider: "opencode-go", name: "OpenCode Go", kind: "plan", icon: "generic", user: "example" };
    const readings = [];
    await page.route("**/*", fixture("en", "light", readings));
    await page.addInitScript(() => localStorage.setItem("magpie.quotaRange", "off"));
    const past = new Date(Date.now() - 86400e3).toISOString();
    for (const sample of [
      { windows: [{ name: "5 hours", used: 100 }], value: "0%", meter: 0, state: "empty" },
      { windows: [{ name: "5 hours", used: 80 }], value: "20%", meter: 20, state: "low" },
      { windows: [{ name: "5 hours", used: 99.999 }], value: "<0.01%", meter: 0.001, state: "low" },
      { windows: [{ name: "5 hours", used: 50 }], value: "50%", meter: 50, failed: true },
      { windows: [{ name: "5 hours", used: 20, resetsAt: past }], asOf: past, value: "Awaiting a new reading" },
    ]) {
      readings.splice(0, readings.length, { ...base, windows: sample.windows, asOf: sample.asOf });
      if (sample.failed) readings.push({ ...base, user: "unread", error: "Unavailable", windows: [] });
      await page.goto("http://magpie.test/?view=usage");
      const summary = page.locator(".quota-overview");
      await summary.waitFor();
      assert.equal(await summary.locator(".quota-total-value").textContent(), sample.value);
      const ring = summary.getByRole("meter");
      assert.equal(await ring.count(), sample.meter == null ? 0 : 1);
      if (sample.meter != null) assert(Math.abs(Number(await ring.getAttribute("aria-valuenow")) - sample.meter) < 1e-8);
      if (sample.state) assert.equal(await summary.locator(".quota-total." + sample.state).count(), 1);
      if (sample.failed || sample.asOf) assert((await summary.locator(".quota-total-note").textContent()).includes("1 not counted"));
      if (sample.asOf) assert.equal(await summary.locator(".quota-total.empty").count(), 0, "unknown isn't zero");
    }
  });
}
