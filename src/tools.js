// Tool handlers: input validation (zod) + calls into the ported engines.
// Kept free of any MCP transport so the parity tests can call them directly.
import { z } from "zod";
import {
  computeRun, runToCliJSON, RECONCILIATION_TOLERANCE, FORM_NAME,
  parseDate, computeBalance, requestDays, usFederalHolidays,
} from "./engine.js";

const amount = (what) => z.number().finite().nonnegative().default(0).describe(what);
const days = (what) =>
  z.array(z.number().finite().nonnegative()).max(7).default([]).describe(what);

// One worker-week on one project. Field names follow the CSV columns of the
// `wh347` command; omitted numbers are 0 (an empty CSV cell is 0 there too).
export const workerSchema = z.object({
  worker: z.string().default("").describe("Free label (name or ID), column 1."),
  type: z.string().regex(/^(J|RA)?$/i, "type must be J, RA or empty").default("")
    .describe("Column 2: J (journeyworker), RA (registered apprentice) or empty."),
  base_rate: amount("Base hourly rate paid, $/h (column 6A)."),
  fringe_health_welfare: amount("Health and welfare plan, $/h."),
  fringe_pension: amount("Pension plan, $/h."),
  fringe_vacation: amount("Vacation / holiday plan, $/h."),
  fringe_training: amount("Training plan, $/h."),
  st_hours: days("Straight-time hours, day 1 to 7 of the payroll week (missing days = 0)."),
  ot_hours: days("Overtime hours, day 1 to 7, paid at base rate x 1.5 (missing days = 0)."),
  cash_in_lieu_rate: amount("Cash paid in lieu of fringe, $/h (column 6C)."),
  gross_all_work: z.number().finite().nonnegative().nullable().optional()
    .describe("Gross earned for all work, column 7B. Omitted or null = 7A."),
  fica: amount("FICA withheld (column 8)."),
  federal_tax: amount("Federal income tax withheld (column 8)."),
  state_tax: amount("State income tax withheld (column 8)."),
  other_deductions: amount("Other permissible deductions (column 8)."),
});

export const crewShape = {
  workers: z.array(workerSchema).min(1).max(500)
    .describe("One entry per worker-week on one project, in WH-347 line order."),
};

const week = (a) => Array.from({ length: 7 }, (_, i) => a[i] ?? 0);

function crewRun(raw) {
  const { workers } = z.object(crewShape).parse(raw);
  // csv_line = line of the worker in the equivalent `wh347` CSV (header = line 1).
  const rows = workers.map((w, i) => ({ line: i + 2, worker: w.worker.trim() }));
  const run = computeRun(workers.map((w) => ({
    base_rate: w.base_rate,
    fringe: {
      health_welfare: w.fringe_health_welfare, pension: w.fringe_pension,
      vacation: w.fringe_vacation, training: w.fringe_training,
    },
    st_by_day: week(w.st_hours),
    ot_by_day: week(w.ot_hours),
    deductions: {
      fica: w.fica, federal_tax: w.federal_tax, state_tax: w.state_tax, other: w.other_deductions,
    },
    cash_in_lieu_rate: w.cash_in_lieu_rate,
    gross_all_work: w.gross_all_work ?? null,
    worker_type: w.type.toUpperCase(),
  })));
  return { rows, run };
}

// Same object as `wh347 --json`.
export function payrollLines(raw) {
  const { rows, run } = crewRun(raw);
  return runToCliJSON(rows, run);
}

// Column 6B reconciliation: sum of 6B over the crew vs. fringe paid to each plan.
export function fringeReconcile(raw) {
  const { rows, run } = crewRun(raw);
  const j = runToCliJSON(rows, run);
  return {
    form: FORM_NAME,
    lines: j.lines.map((l) => ({
      csv_line: l.csv_line, worker: l.worker, total_hours: l.total_hours, fringe_6b: l.fringe_6b,
    })),
    plan_totals: j.plan_totals,
    plan_totals_sum: j.plan_totals_sum,
    fringe_column_6b_sum: j.fringe_column_6b_sum,
    tolerance: RECONCILIATION_TOLERANCE,
    reconciles: j.reconciles,
  };
}

const date = (what) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD").describe(what);
const num = (what) => z.number().finite().describe(what);

export const ptoShape = {
  policy: z.object({
    period: z.enum(["monthly", "annual"])
      .describe("monthly: rate days earned per calendar month worked; annual: rate days granted up front each year."),
    rate: num("Days per month (monthly) or per year (annual)."),
    annual_cap: num("Cap on accrued days, applied before carryover is added."),
    carryover_max: num("Cap on the carryover entered for the employee."),
    tier1_years: num("Tenure threshold of tier 1 in years (0 disables it).").default(0),
    tier1_bonus: num("Added to rate once tier 1 is reached.").default(0),
    tier2_years: num("Tenure threshold of tier 2 in years (0 disables it); replaces tier 1.").default(0),
    tier2_bonus: num("Added to rate once tier 2 is reached.").default(0),
  }),
  hire_date: date("Hire date, YYYY-MM-DD."),
  as_of: date("Balance date, YYYY-MM-DD."),
  carryover: num("Carryover entered from the previous year, in days, before the policy cap.").default(0),
  requests: z.array(z.object({
    start: date("First day, YYYY-MM-DD."),
    end: date("Last day (inclusive), YYYY-MM-DD."),
    start_half: z.boolean().default(false).describe("First day is a half day."),
    end_half: z.boolean().default(false).describe("Last day is a half day."),
    status: z.enum(["pending", "approved", "denied", "cancelled"]),
  })).max(1000).default([]).describe("Leave requests. Only approved ones are deducted."),
  holidays: z.array(date("Holiday date.")).max(1000).default([])
    .describe("Non-working holiday dates, YYYY-MM-DD."),
  us_federal_holidays_years: z.array(z.number().int().min(1).max(9999)).max(50).default([])
    .describe("Also treat the 11 U.S. federal holidays (observed dates) of these years as non-working."),
};

export function ptoAccrual(raw) {
  const i = z.object(ptoShape).parse(raw);
  const fed = i.us_federal_holidays_years.flatMap((y) => usFederalHolidays(y).map((h) => h.date));
  const holidays = [...i.holidays, ...fed].map(parseDate);
  const requests = i.requests.map((r) => ({ ...r, start: parseDate(r.start), end: parseDate(r.end) }));
  const balance = computeBalance(
    i.policy, { hire: parseDate(i.hire_date), carryover: i.carryover }, requests, holidays, parseDate(i.as_of),
  );
  const hs = new Set(holidays.map((h) => h.n));
  return { balance, request_days: requests.map((r) => requestDays(r, hs)) };
}
