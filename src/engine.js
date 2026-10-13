// Line-by-line JavaScript port of the TableTemplates Go engines:
//   codeberg.org/tresor2k/tabletemplates-go/wh347      (wh347.go)
//   codeberg.org/tresor2k/tabletemplates-go/cmd/wh347  (main.go, --json output)
//   codeberg.org/tresor2k/tabletemplates-go/pto        (pto.go, holidays.go)
// Same operations in the same order, plain IEEE-754 doubles, no intermediate
// rounding. test/parity.test.js compares the output byte for byte with the Go
// engines on golden cases.

// ---------------------------------------------------------------- WH-347

export const RECONCILIATION_TOLERANCE = 0.005;
export const OT_MULTIPLIER = 1.5;
export const MAX_SANE_WEEK_HOURS = 112.0;
export const FORM_NAME = "WH-347 (Rev. January 2025)";

const fringeTotal = (f) => f.health_welfare + f.pension + f.vacation + f.training;
const deductionsTotal = (d) => d.fica + d.federal_tax + d.state_tax + d.other;

function sumWeek(days) {
  let s = 0.0;
  for (const d of days) s += d;
  return s;
}

// ComputeLine. w = { base_rate, fringe{health_welfare,pension,vacation,training},
// st_by_day[7], ot_by_day[7], deductions{fica,federal_tax,state_tax,other},
// cash_in_lieu_rate, gross_all_work (number | null), worker_type ("J"|"RA"|"") }.
export function computeLine(w) {
  const st = sumWeek(w.st_by_day);
  const ot = sumWeek(w.ot_by_day);
  const hours = st + ot;
  const fringeRate = fringeTotal(w.fringe);
  const otRate = w.base_rate * OT_MULTIPLIER;
  const gross = st * w.base_rate + ot * w.base_rate * OT_MULTIPLIER;
  const cashInLieu = hours * w.cash_in_lieu_rate;
  const grossProject = gross + cashInLieu;
  const entered = w.gross_all_work !== null && w.gross_all_work !== undefined;
  const grossAllWork = entered ? w.gross_all_work : grossProject;
  const deductions = deductionsTotal(w.deductions);
  const net = grossAllWork - deductions;
  const review =
    net < 0 || hours > MAX_SANE_WEEK_HOURS || w.base_rate < 0 ||
    grossAllWork < grossProject - RECONCILIATION_TOLERANCE;
  return {
    worker_type: w.worker_type,
    st_hours: st,
    ot_hours: ot,
    total_hours: hours,
    st_rate: w.base_rate,
    ot_rate: otRate,
    gross,
    fringe_credit: hours * fringeRate,
    cash_in_lieu: cashInLieu,
    gross_project: grossProject,
    gross_all_work: grossAllWork,
    gross_all_work_entered: entered,
    total_deductions: deductions,
    net_pay: net,
    rate_plus_fringe: w.base_rate + fringeRate,
    sanity: review ? "review" : "ok",
  };
}

// ComputeRun: all lines, per-plan fringe totals and the 6B reconciliation.
export function computeRun(workers) {
  const r = {
    lines: [],
    plan_totals: { health_welfare: 0, pension: 0, vacation: 0, training: 0 },
    plan_totals_sum: 0,
    fringe_column_sum: 0,
    reconciles: false,
  };
  for (const w of workers) {
    const l = computeLine(w);
    r.lines.push(l);
    const h = l.total_hours;
    r.plan_totals.health_welfare += h * w.fringe.health_welfare;
    r.plan_totals.pension += h * w.fringe.pension;
    r.plan_totals.vacation += h * w.fringe.vacation;
    r.plan_totals.training += h * w.fringe.training;
    r.fringe_column_sum += l.fringe_credit;
  }
  r.plan_totals_sum = fringeTotal(r.plan_totals);
  r.reconciles = Math.abs(r.fringe_column_sum - r.plan_totals_sum) < RECONCILIATION_TOLERANCE;
  return r;
}

// RoundCents: halves toward +Inf. Display only, never inside the calculation.
export function roundCents(n) {
  const x = n * 100;
  let f = Math.floor(x);
  if (x - f >= 0.5) f++;
  return f / 100;
}

// writeJSON of cmd/wh347: same keys, same order, same rounding.
// rows[i] = { line, worker }; csv_line is the line of row i in the equivalent CSV.
export function runToCliJSON(rows, r) {
  const c = roundCents;
  return {
    form: FORM_NAME,
    lines: r.lines.map((l, i) => ({
      csv_line: rows[i].line,
      worker: rows[i].worker,
      worker_type: l.worker_type,
      st_hours: c(l.st_hours),
      ot_hours: c(l.ot_hours),
      total_hours: c(l.total_hours),
      rate_6a_st: c(l.st_rate),
      rate_6a_ot: c(l.ot_rate),
      fringe_6b: c(l.fringe_credit),
      cash_in_lieu_6c: c(l.cash_in_lieu),
      gross_project_7a: c(l.gross_project),
      gross_all_work_7b: c(l.gross_all_work),
      gross_all_work_7b_entered: l.gross_all_work_entered,
      deductions_8: c(l.total_deductions),
      net_pay_9: c(l.net_pay),
      sanity: l.sanity,
    })),
    plan_totals: {
      health_welfare: c(r.plan_totals.health_welfare),
      pension: c(r.plan_totals.pension),
      vacation: c(r.plan_totals.vacation),
      training: c(r.plan_totals.training),
    },
    plan_totals_sum: c(r.plan_totals_sum),
    fringe_column_6b_sum: c(r.fringe_column_sum),
    reconciles: r.reconciles,
  };
}

// ---------------------------------------------------------------- PTO

const DAY_MS = 86400000;

// Parses a strict YYYY-MM-DD calendar date into { y, m, d, n } where n is the
// day number since 1970-01-01 (Go epochDay). Throws on an impossible date.
export function parseDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) {
    const y = +m[1], mo = +m[2], d = +m[3];
    const t = new Date(0);
    t.setUTCFullYear(y, mo - 1, d);
    if (t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d) {
      return { y, m: mo, d, n: Math.floor(t.getTime() / DAY_MS) };
    }
  }
  throw new Error(`"${s}" is not a valid YYYY-MM-DD date`);
}

const isWeekendDay = (n) => {
  const dow = (((n + 4) % 7) + 7) % 7; // 1970-01-01 was a Thursday; 0 = Sunday.
  return dow === 0 || dow === 6;
};
const clampInt = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

function accrualStart(hire, year) {
  if (hire.y >= year) return [hire.y, hire.m];
  return [year, 1];
}

export function monthsWorkedThisYear(hire, asof) {
  const [sy, sm] = accrualStart(hire, asof.y);
  return clampInt((asof.y - sy) * 12 + asof.m - sm + 1, 0, 12);
}

export const yearsOfService = (hire, asof) => (asof.n - hire.n) / 365;

export function effectiveRate(p, years) {
  let bonus = 0.0;
  if (p.tier2_years > 0 && years >= p.tier2_years) bonus = p.tier2_bonus;
  else if (p.tier1_years > 0 && years >= p.tier1_years) bonus = p.tier1_bonus;
  return p.rate + bonus;
}

export function accruedDays(p, hire, asof) {
  const rate = effectiveRate(p, yearsOfService(hire, asof));
  const months = monthsWorkedThisYear(hire, asof);
  if (p.period === "monthly") return Math.min(p.annual_cap, months * rate);
  if (months === 0 || asof.n < hire.n) return 0;
  const [, sm] = accrualStart(hire, asof.y);
  const covered = clampInt(12 - sm + 1, 0, 12);
  return Math.min(p.annual_cap, (rate * covered) / 12);
}

function networkdays(a, b, hs) {
  if (b < a) return 0;
  const fullWeeks = Math.trunc((b - a + 1) / 7);
  let count = fullWeeks * 5;
  for (let i = a + fullWeeks * 7; i <= b; i++) if (!isWeekendDay(i)) count++;
  for (const h of hs) if (h >= a && h <= b && !isWeekendDay(h)) count--;
  return count;
}

// r = { start, end (parsed dates), start_half, end_half }; hs = Set of day numbers.
export function requestDays(r, hs) {
  const a = r.start.n, b = r.end.n;
  const base = networkdays(a, b, hs);
  if (base <= 0) return 0;
  const isWorkday = (n) => !isWeekendDay(n) && !hs.has(n);
  if (a === b) {
    if ((r.start_half || r.end_half) && isWorkday(a)) return 0.5;
    return base;
  }
  let days = base;
  if (r.start_half && isWorkday(a)) days -= 0.5;
  if (r.end_half && isWorkday(b)) days -= 0.5;
  return Math.max(0, days);
}

// ComputeBalance. Only approved requests are deducted; pending ones are
// reported; denied and cancelled are ignored.
export function computeBalance(p, e, requests, holidays, asof) {
  const years = yearsOfService(e.hire, asof);
  const accrued = accruedDays(p, e.hire, asof);
  const carryover = Math.min(e.carryover, p.carryover_max);
  const hs = new Set(holidays.map((h) => h.n));
  let taken = 0, pending = 0;
  for (const r of requests) {
    if (r.status === "approved") taken += requestDays(r, hs);
    else if (r.status === "pending") pending += requestDays(r, hs);
  }
  const left = carryover + accrued - taken;
  return {
    months_worked: monthsWorkedThisYear(e.hire, asof),
    years_of_service: years,
    effective_rate: effectiveRate(p, years),
    accrued,
    carryover,
    taken,
    pending,
    left,
    is_negative: left < 0,
  };
}

// USFederalHolidays (holidays.go): the 11 federal holidays at observed dates.
const pad = (n, w = 2) => String(n).padStart(w, "0");
const ymd = (t) => `${pad(t.getUTCFullYear(), 4)}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
const utcDate = (y, m, d) => { const t = new Date(0); t.setUTCFullYear(y, m - 1, d); return t; };
const addDays = (t, n) => new Date(t.getTime() + n * DAY_MS);
function nthWeekday(y, m, wd, nth) {
  const first = utcDate(y, m, 1);
  return addDays(first, ((wd - first.getUTCDay() + 7) % 7) + (nth - 1) * 7);
}
function lastWeekday(y, m, lastDay, wd) {
  const last = utcDate(y, m, lastDay);
  return addDays(last, -((last.getUTCDay() - wd + 7) % 7));
}
function observed(t) {
  const wd = t.getUTCDay();
  if (wd === 6) return addDays(t, -1);
  if (wd === 0) return addDays(t, 1);
  return t;
}
export function usFederalHolidays(year) {
  return [
    [observed(utcDate(year, 1, 1)), "New Year's Day"],
    [nthWeekday(year, 1, 1, 3), "Martin Luther King Jr. Day"],
    [nthWeekday(year, 2, 1, 3), "Washington's Birthday"],
    [lastWeekday(year, 5, 31, 1), "Memorial Day"],
    [observed(utcDate(year, 6, 19)), "Juneteenth"],
    [observed(utcDate(year, 7, 4)), "Independence Day"],
    [nthWeekday(year, 9, 1, 1), "Labor Day"],
    [nthWeekday(year, 10, 1, 2), "Columbus Day"],
    [observed(utcDate(year, 11, 11)), "Veterans Day"],
    [nthWeekday(year, 11, 4, 4), "Thanksgiving Day"],
    [observed(utcDate(year, 12, 25)), "Christmas Day"],
  ].map(([t, name]) => ({ date: ymd(t), name }));
}
