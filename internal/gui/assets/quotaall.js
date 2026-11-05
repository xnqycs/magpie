// Provider allowance aggregation, loaded on demand by the overview, tray
// and Routing page. The overview opts into remaining totals; the compact
// tray and Routing aggregate keeps its original Used / Left semantics.
//
// mergeQuotas: one provider's accounts as one figure a window. Only what
// reads alike is put together: a counted window (WorkBuddy's credits) adds
// its amounts and limits, a wallet its balances, each in one unit; a window
// said only as a share is averaged, and only over accounts on one plan,
// whose windows are the same size, so the mean is the share of their
// allowance together. A share is never added to a count. An account whose
// reading failed is not 0 but unknown: it is left out and counted as that;
// so is a window an earlier reading (asOf) stands in for whose reset has
// passed. A window only the vendor's text says has nothing to add up and is
// left out. A window the account can't spend, held by another used up that
// starts again after it (heldBy: 0% of 7 days left, 100% of 5 hours), has
// nothing left to count: it adds its whole as used (#4791). Unlimited only where every account read says so, and one
// account's window alone is that account's, already below: only what two
// or more have goes together (a Plus and a Pro account have no 5 hours in
// common). The windows keep their family and pool, so familyWindows folds
// them as an account's. accounts: those with a reading; unknown: those
// without.
//
// quotaAll: the compact strip under the tray panel's
// head: "All 3 accounts", each window's figure and a thin bar, and how many
// couldn't be read. Nothing when fewer than two accounts read, or nothing
// of theirs adds up. No account is named in it (Hide accounts).
function mergeQuotas(subs, now = Date.now(), overview = false) {
  const read = subs.filter((q) => !q.error && (q.windows?.length || q.balance));
  const unknown = subs.length - read.length;
  const plans = new Set(read.map((q) => q.plan || ""));
  const by = new Map();
  for (const q of read) {
    for (const w of q.windows || []) {
      if (w.text) continue;
      const kind = w.unlimited ? "u" : w.limit > 0 ? "c" : w.balance != null ? "b" : w.used != null ? "p:" + (q.plan || "") : "";
      if (!kind) continue;
      const k = JSON.stringify([q.provider, q.from || "", w.name, w.family || "", w.pool || "", w.unit || "", kind, overview ? q.plan || "" : ""]);
      let m = by.get(k);
      if (!m) by.set(k, (m = { w, provider: q.provider, from: q.from || "", kind, plan: q.plan || "", n: 0, stale: 0, held: 0, amount: 0, limit: 0, balance: 0, used: 0, left: 0, soon: null }));
      if (q.asOf && w.resetsAt && Date.parse(w.resetsAt) <= now) { m.stale++; continue; }
      m.n++;
      const held = w.heldBy && kind !== "u" && kind !== "b";
      if (held) m.held++;
      if (kind === "c") { m.amount += held ? w.limit : Math.max(0, w.amount || 0); m.limit += w.limit; m.left += held ? 0 : Math.max(0, w.limit - Math.max(0, w.amount || 0)); }
      else if (kind === "b") m.balance += w.balance;
      else if (kind !== "u") m.used += held ? 100 : to100(w.used);
      const at = w.resetsAt && Date.parse(w.resetsAt);
      if (at > now && (m.soon == null || at < m.soon)) m.soon = at;
    }
  }
  const windows = [];
  for (const m of by.values()) {
    if (!overview && m.n < 2) continue; // one account's is already below
    if (!overview && m.kind === "u" && m.n < read.length) continue;
    const { w } = m;
    const out = { name: w.name, family: w.family, pool: w.pool, unit: w.unit, accounts: m.n, unknown: m.stale, held: m.held, how: m.kind[0] };
    if (m.kind === "u") out.unlimited = true;
    else if (m.kind === "c") Object.assign(out, { amount: m.amount, limit: m.limit, used: m.limit ? (100 * m.amount) / m.limit : 0 });
    else if (m.kind === "b") out.balance = m.balance;
    else {
      out.used = m.n ? Math.round((10 * m.used) / m.n) / 10 : 0;
      if (plans.size > 1) out.plan = m.plan;
    }
    if (overview) {
      // The overview counts even one account and keeps raw shares until
      // formatting. Its totals never follow the Used / Left preference.
      out.plan = m.plan;
      out.left = m.kind === "c" ? m.left : m.kind === "b" ? m.balance : Math.max(0, m.n - m.used / 100);
      out.percentLeft = m.kind === "c" ? (m.limit ? 100 * out.left / m.limit : 0) : m.n ? 100 * out.left / m.n : 0;
      const cohort = subs.filter((q) => q.provider === m.provider && (q.from || "") === m.from && (q.plan || "") === m.plan);
      out.missing = cohort.filter((q) => q.error || !(q.windows || []).some((x) => !x.text && x.name === w.name && (x.family || "") === (w.family || "") && (x.pool || "") === (w.pool || "") && (x.unit || "") === (w.unit || "") && (x.unlimited || x.limit > 0 || x.balance != null || Number.isFinite(x.used)))).length;
    }
    if (m.soon) out.firstReset = new Date(m.soon).toISOString();
    windows.push(out);
  }
  return { accounts: read.length, unknown, windows };
}
// quotaAll: the strip (above)
function quotaAll(subs, cls = "", max = Infinity) {
  if (subs.length < 2) return null;
  const all = mergeQuotas(subs);
  if (all.accounts < 2 || !all.windows.length) return null;
  const box = el("div", "quota-all" + (cls ? " " + cls : ""));
  const lead = el("span", "quota-all-head", t("All {n} accounts", { n: subs.length }));
  lead.title = t("These accounts' windows together: amounts of one unit are added up; a window said only as a share is the mean of the accounts on one plan, which have the same allowance. Each account is below.");
  box.append(lead);
  const ws = familyWindows(all.windows);
  for (const w of ws.slice(0, max)) {
    const item = el("span", "quota-all-w");
    const name = t(w.name) + (w.plan ? " · " + w.plan : "");
    item.append(el("span", "quota-all-name", name), el("span", "quota-all-n", quotaText(w)));
    if (!w.unlimited && !quotaNoShare(w)) {
      const bar = el("span", "quota-all-bar" + (to100(w.used) >= 90 ? " full" : ""));
      const fill = el("i");
      fill.style.width = quotaFill(w) + "%";
      bar.append(fill);
      item.append(bar);
    }
    item.title = tipLines(
      name + " · " + quotaText(w),
      t(w.how === "p" ? "The mean of {n} accounts on one plan" : w.how === "u" ? "Unlimited on each of {n} accounts" : "Added up over {n} accounts", { n: w.accounts }),
      w.unknown && t("{n} more read before it started again: left out", { n: w.unknown }),
      w.held && t("{n} of them can't spend theirs before a longer window used up starts again: counted as none left", { n: w.held }),
      w.firstReset && t("The first of them starts again {when}", { when: resetClock(new Date(w.firstReset)) }),
      w.tiers && "\n" + tiersText(w));
    box.append(item);
  }
  if (all.unknown) {
    const u = el("span", "quota-all-unknown", t("{n} couldn't be read", { n: all.unknown }));
    u.title = t("An account whose reading failed isn't counted as empty or full: it is left out of these figures");
    box.append(u);
  }
  return box;
}
window.mergeQuotas = mergeQuotas;
window.quotaAll = quotaAll;

// A period remains its own allowance; the three numbers aren't additive.
// Keep model families together only within a plan (familyWindows otherwise
// chooses the tightest across plans). Pools keep their own identity too.
function quotaOverview(subs) {
  if (!subs.some((q) => q.windows?.length)) return null;
  const all = mergeQuotas(subs, Date.now(), true);
  const box = el("section", "quota-overview");
  const head = el("div", "quota-overview-head");
  head.append(el("b", "", t("Total remaining")), el("span", "", t("{n} accounts in this overview", { n: subs.length })));
  box.append(head);
  const grid = el("div", "quota-overview-grid");
  const families = new Map();
  for (const w of all.windows) {
    const key = JSON.stringify([w.plan, w.unit || "", w.how]);
    if (!families.has(key)) families.set(key, []);
    families.get(key).push(w);
  }
  const ws = [...families.values()].flatMap(familyWindows);
  grid.style.gridTemplateColumns = `repeat(${Math.max(1, Math.min(3, ws.length))}, minmax(0, 1fr))`;
  for (const w of ws) {
    const item = el("div", "quota-total");
    const name = (w.pool && !w.window ? w.pool + " · " : "") + t(w.name) + (w.plan ? " · " + w.plan : "");
    item.append(el("span", "quota-total-name", name));
    if (!w.accounts) {
      item.append(el("b", "quota-total-value", t("Awaiting a new reading")));
    } else {
      const numeric = w.unlimited ? t("Unlimited") : (w.how === "p" ? "≈ " : "") + quotaTotalNumber(w.left);
      item.append(el("b", "quota-total-value", numeric));
      item.append(el("span", "quota-total-unit", t(w.how === "p" ? "full-account allowances" : w.unit || "Left")));
      const info = w.how === "p" ? t("Average {n}% left · {accounts} accounts", { n: quotaTotalNumber(w.percentLeft), accounts: w.accounts })
        : t(w.unlimited ? "Unlimited on each of {n} accounts" : "Added up over {n} accounts", { n: w.accounts });
      item.append(el("span", "quota-total-info", info));
      if (!w.unlimited && w.how !== "b") {
        item.classList.toggle("low", w.percentLeft > 0 && w.percentLeft <= 20);
        item.classList.toggle("empty", w.percentLeft <= 0);
        const bar = el("div", "quota-track"), fill = el("i");
        fill.style.width = to100(w.percentLeft) + "%";
        bar.append(fill); item.append(bar);
      }
    }
    const omitted = (w.unknown || 0) + (w.missing || 0);
    if (omitted) item.append(el("span", "quota-total-note", t("{n} not counted: missing or outdated readings", { n: omitted })));
    if (w.held) item.append(el("span", "quota-total-note", t("{n} limited by another window; no remainder counted", { n: w.held })));
    if (w.firstReset) item.title = t("The first of them starts again {when}", { when: resetClock(new Date(w.firstReset)) });
    grid.append(item);
  }
  if (ws.length) box.append(grid, el("p", "quota-overview-note", t("Each period has its own limit. These totals cannot be added together.")));
  else box.append(el("p", "quota-overview-note", t("No comparable allowance reported")));
  if (all.unknown) box.append(el("span", "quota-overview-unknown", t("{n} couldn't be read", { n: all.unknown })));
  return box;
}
function quotaTotalNumber(n) {
  if (n > 0 && n < 0.01) return "<" + countFormat.format(0.01);
  return countFormat.format(n);
}
window.quotaOverview = quotaOverview;
