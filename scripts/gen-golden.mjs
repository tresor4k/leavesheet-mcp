// Regenerates test/golden.json by running the Go engines (Go >= 1.24 required):
//   node scripts/gen-golden.mjs
// The Go sources are read from the sibling folders ../wh347-go, ../pto-go and
// ../wh347-cli, assembled into a temporary module, then:
//   - each WH-347 case is converted to the `wh347` CSV and run through
//     `wh347 --json -` (stdout and exit status are recorded as-is);
//   - the PTO cases are run through golden_pto.go (pto.ComputeBalance,
//     pto.RequestDays, pto.USFederalHolidays).
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgs = join(here, "..", "..");

const w = (worker, type, base_rate, fringe, st, ot, extra = {}) => ({
  worker, type, base_rate,
  fringe_health_welfare: fringe[0], fringe_pension: fringe[1],
  fringe_vacation: fringe[2], fringe_training: fringe[3],
  st_hours: st, ot_hours: ot, ...extra,
});
const F0 = [0, 0, 0, 0];

const WH347 = [
  ["reference example (wh347 --example)", [
    w("John Mason", "J", 30, [4, 2, 0, 0], [8, 8, 8, 8, 8, 0, 0], [4, 0, 0, 0, 0, 0, 0], { other_deductions: 310 }),
    w("Worker 2", "RA", 20, [1, 1, 0.5, 0.25], [8, 8, 8, 8, 8, 0, 0], [0, 0, 0, 0, 0, 0, 0]),
  ]],
  ["overtime spread over several days", [
    w("Ana Ruiz", "J", 37.83, [9.17, 6.42, 1.1, 0.37], [8, 8, 8, 8, 8, 4], [2, 1.5, 0, 2.25, 0, 3]),
  ]],
  ["fringe paid in cash vs. to plans", [
    w("Cash fringe", "J", 41.2, F0, [8, 8, 8, 8, 8], [], { cash_in_lieu_rate: 12.48 }),
    w("Plan fringe", "J", 41.2, [7.13, 4.1, 1.05, 0.2], [8, 8, 8, 8, 8], []),
    w("Split fringe", "J", 41.2, [7.13, 0, 0, 0], [8, 8, 8, 8, 8], [], { cash_in_lieu_rate: 5.35 }),
  ]],
  ["itemized deductions", [
    w("D. Itemized", "J", 28.65, [5.5, 3.25, 0, 0.15], [8, 8, 8, 8, 8], [0, 0, 1.5], {
      fica: 98.37, federal_tax: 121.05, state_tax: 33.1, other_deductions: 15,
    }),
  ]],
  ["7B entered above and below 7A", [
    w("Other jobs too", "J", 30, [4, 2, 0, 0], [8, 8, 8, 8, 8], [4], { gross_all_work: 1500, other_deductions: 310 }),
    w("7B below 7A", "J", 30, [4, 2, 0, 0], [8, 8, 8, 8, 8], [4], { gross_all_work: 1000, fica: 76.5 }),
  ]],
  ["negative net pay flagged for review", [
    w("Overdeducted", "J", 22, F0, [4, 4], [], { federal_tax: 120, state_tax: 30, other_deductions: 40 }),
  ]],
  ["more than 112 hours flagged for review", [
    w("Long week", "J", 25, [1, 1, 1, 1], [16, 16, 16, 16, 16, 16, 10], [1, 1, 1, 1, 1, 0, 0]),
  ]],
  ["apprentice, lowercase and empty type", [
    w("Apprentice", "ra", 19.37, [2.01, 1.11, 0.33, 0.47], [7.5, 7.5, 7.5, 7.5, 7.5], [0, 0.75]),
    w("Journey", "j", 44.18, [10.02, 8.4, 0, 0.71], [10, 10, 10, 10], [0, 0, 0, 0, 2]),
    w("Unspecified", "", 31, [3, 3, 0, 0], [8, 8], []),
  ]],
  ["cent-rounding edge values", [
    w("Half cent", "J", 10.005, [0.005, 0.005, 0, 0], [1], [1], { fica: 0.015 }),
    w("Thirds", "J", 33.335, [0.1, 0.2, 0.3, 0.07], [7.33, 7.33, 7.34], [0.1, 0.2], { state_tax: 0.105 }),
    w("Tiny", "J", 0.07, [0.01, 0.02, 0, 0], [0.1, 0.2], [0.3]),
  ]],
  ["empty worker row", [w("", "", 0, F0, [], [])]],
  ["weekend days (day 6 and day 7)", [
    w("Weekend crew", "J", 35.5, [6.25, 4, 0.5, 0.25], [0, 0, 0, 0, 0, 8, 8], [0, 0, 0, 0, 0, 2, 4], { fica: 50.11 }),
  ]],
  ["crew of six, mixed", [
    w("A", "J", 52.1, [12.33, 9.87, 2.5, 0.65], [8, 8, 8, 8, 8], [1, 1, 1, 1, 1]),
    w("B", "J", 48.75, [12.33, 9.87, 2.5, 0.65], [10, 10, 10, 10], [], { fica: 182.41, federal_tax: 260 }),
    w("C", "RA", 26.06, [12.33, 4.2, 0, 0.65], [8, 8, 8, 8, 8], [0, 0, 0, 0, 0, 3.5]),
    w("D", "J", 52.1, F0, [6, 6, 6], [], { cash_in_lieu_rate: 25.35 }),
    w("E", "J", 39.99, [0.01, 0.02, 0.03, 0.04], [8.25, 8.25, 8.25, 8.25], [0.25, 0.25, 0.25, 0.25], { gross_all_work: 1801.12 }),
    w("F", "", 61.4, [12.33, 9.87, 2.5, 0.65], [12], [4], { other_deductions: 1500 }),
  ]],
];

const COLS = ["worker", "type", "base_rate", "fringe_health_welfare", "fringe_pension", "fringe_vacation", "fringe_training",
  "st_d1", "st_d2", "st_d3", "st_d4", "st_d5", "st_d6", "st_d7", "ot_d1", "ot_d2", "ot_d3", "ot_d4", "ot_d5", "ot_d6", "ot_d7",
  "cash_in_lieu_rate", "gross_all_work", "fica", "federal_tax", "state_tax", "other_deductions"];
function toCSV(workers) {
  const lines = [COLS.join(",")];
  for (const x of workers) {
    const v = (k) => (x[k] === undefined || x[k] === null ? "" : String(x[k]));
    const day = (a, i) => (a[i] === undefined ? "" : String(a[i]));
    lines.push([v("worker"), v("type"), v("base_rate"), v("fringe_health_welfare"), v("fringe_pension"),
      v("fringe_vacation"), v("fringe_training"),
      ...[0, 1, 2, 3, 4, 5, 6].map((i) => day(x.st_hours, i)), ...[0, 1, 2, 3, 4, 5, 6].map((i) => day(x.ot_hours, i)),
      v("cash_in_lieu_rate"), v("gross_all_work"), v("fica"), v("federal_tax"), v("state_tax"), v("other_deductions"),
    ].join(","));
  }
  return lines.join("\n") + "\n";
}

const pol = (period, rate, annual_cap, carryover_max, tiers = {}) => ({ period, rate, annual_cap, carryover_max, ...tiers });
const STD = pol("monthly", 1.25, 15, 5, { tier1_years: 2, tier1_bonus: 0.25, tier2_years: 5, tier2_bonus: 0.5 });
const ANNUAL = pol("annual", 15, 20, 5, { tier1_years: 2, tier1_bonus: 3, tier2_years: 5, tier2_bonus: 5 });
const req = (start, end, status, start_half = false, end_half = false) => ({ start, end, status, start_half, end_half });

const PTO = [
  ["monthly, hired mid-month", { policy: STD, hire_date: "2026-03-15", as_of: "2026-06-30", carryover: 3 }],
  ["monthly, hired later in the as-of month", { policy: STD, hire_date: "2026-06-20", as_of: "2026-06-10" }],
  ["monthly, annual cap reached", { policy: pol("monthly", 2, 15, 5), hire_date: "2025-02-01", as_of: "2026-11-15" }],
  ["tier 1 the day before the 2-year anniversary", { policy: STD, hire_date: "2024-07-01", as_of: "2026-06-30" }],
  ["tier 1 on the 2-year anniversary", { policy: STD, hire_date: "2024-07-01", as_of: "2026-07-01" }],
  ["tier 2 on the 5-year anniversary (leap year inside)", { policy: STD, hire_date: "2021-03-01", as_of: "2026-03-01" }],
  ["tier 2 replaces tier 1, cap reached", { policy: STD, hire_date: "2015-01-10", as_of: "2026-12-31" }],
  ["year end: December 31 with capped carryover", { policy: STD, hire_date: "2023-04-03", as_of: "2026-12-31", carryover: 9 }],
  ["year end: January 1 restarts accrual", { policy: STD, hire_date: "2023-04-03", as_of: "2027-01-01", carryover: 9 }],
  ["annual grant prorated in the hire year", { policy: ANNUAL, hire_date: "2026-04-10", as_of: "2026-05-01" }],
  ["annual grant, as-of before hire", { policy: ANNUAL, hire_date: "2026-04-10", as_of: "2026-04-09" }],
  ["annual grant, tier 2, capped", { policy: ANNUAL, hire_date: "2020-09-15", as_of: "2026-02-01", carryover: 2.5 }],
  ["requests with US federal holidays and half days", {
    policy: STD, hire_date: "2022-01-03", as_of: "2026-07-31", carryover: 4, us_federal_holidays_years: [2026],
    requests: [
      req("2026-06-29", "2026-07-07", "approved"),
      req("2026-05-22", "2026-05-26", "approved", true, false),
      req("2026-07-20", "2026-07-21", "pending", false, true),
      req("2026-03-02", "2026-03-06", "denied"),
      req("2026-04-06", "2026-04-07", "cancelled"),
    ],
  }],
  ["single half day, half day on a holiday, reversed range", {
    policy: STD, hire_date: "2025-01-06", as_of: "2026-12-15", us_federal_holidays_years: [2026],
    requests: [
      req("2026-02-10", "2026-02-10", "approved", true),
      req("2026-11-26", "2026-11-26", "approved", false, true),
      req("2026-12-28", "2026-12-24", "approved"),
      req("2026-08-08", "2026-08-09", "approved", true, true),
    ],
  }],
  ["negative balance", {
    policy: pol("monthly", 1, 12, 0), hire_date: "2026-01-12", as_of: "2026-02-15",
    requests: [req("2026-02-02", "2026-02-13", "approved")],
  }],
  ["negative carryover entered, custom holidays with duplicates and weekend", {
    policy: STD, hire_date: "2019-05-20", as_of: "2026-05-29", carryover: -1.5,
    holidays: ["2026-05-25", "2026-05-25", "2026-05-23", "2026-05-27"],
    requests: [req("2026-05-18", "2026-05-29", "approved", false, true), req("2026-05-27", "2026-05-27", "pending", true)],
  }],
];

const HOLIDAY_YEARS = Array.from({ length: 16 }, (_, i) => String(2020 + i));

const tmp = mkdtempSync(join(tmpdir(), "leavesheet-golden-"));
try {
  const copy = (from, to) => {
    mkdirSync(join(tmp, to), { recursive: true });
    for (const f of readdirSync(join(pkgs, from)).filter((f) => f.endsWith(".go") && !f.endsWith("_test.go"))) {
      cpSync(join(pkgs, from, f), join(tmp, to, f));
    }
  };
  copy("wh347-go", "wh347");
  copy("pto-go", "pto");
  copy("wh347-cli", "cmd/wh347");
  mkdirSync(join(tmp, "cmd/ptogolden"));
  cpSync(join(here, "golden_pto.go"), join(tmp, "cmd/ptogolden/main.go"));
  writeFileSync(join(tmp, "go.mod"), "module codeberg.org/tresor2k/tabletemplates-go\n\ngo 1.24\n");
  const bin = join(tmp, process.platform === "win32" ? "wh347.exe" : "wh347");
  execFileSync("go", ["build", "-o", bin, "./cmd/wh347"], { cwd: tmp, stdio: "inherit" });
  const goVersion = execFileSync("go", ["version"], { encoding: "utf8" }).trim();

  const wh347 = WH347.map(([name, workers]) => {
    const r = spawnSync(bin, ["--json", "-"], { input: toCSV(workers), encoding: "utf8" });
    if (r.status !== 0 && r.status !== 1) throw new Error(`${name}: exit ${r.status} ${r.stderr}`);
    return { name, input: { workers }, exit_status: r.status, stdout: r.stdout };
  });

  const casesFile = join(tmp, "pto_cases.json");
  writeFileSync(casesFile, JSON.stringify(PTO.map(([, input]) => input)));
  const out = execFileSync("go", ["run", "./cmd/ptogolden", casesFile, ...HOLIDAY_YEARS], { cwd: tmp, encoding: "utf8" })
    .trim().split(/\r?\n/);
  const pto = PTO.map(([name, input], i) => ({ name, input, output: out[i] }));
  const holidays = out[PTO.length];

  writeFileSync(join(here, "..", "test", "golden.json"),
    JSON.stringify({ generated_by: `scripts/gen-golden.mjs with ${goVersion}`, wh347, pto, us_federal_holidays: holidays }, null, 1) + "\n");
  console.log(`golden.json: ${wh347.length} WH-347 cases, ${pto.length} PTO cases, ${HOLIDAY_YEARS.length} holiday years`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
