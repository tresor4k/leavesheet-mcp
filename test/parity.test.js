// Byte-for-byte parity with the Go engines on the golden cases of
// test/golden.json (regenerate with: node scripts/gen-golden.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { payrollLines, fringeReconcile, ptoAccrual } from "../src/tools.js";
import { usFederalHolidays } from "../src/engine.js";

const golden = JSON.parse(readFileSync(new URL("./golden.json", import.meta.url), "utf8"));

for (const c of golden.wh347) {
  test(`wh347_payroll_lines = wh347 --json: ${c.name}`, () => {
    assert.equal(JSON.stringify(payrollLines(c.input), null, 2) + "\n", c.stdout);
  });
  test(`wh347_fringe_reconcile = wh347 --json: ${c.name}`, () => {
    const go = JSON.parse(c.stdout);
    const js = fringeReconcile(c.input);
    const pick = (o) => JSON.stringify([
      o.lines.map((l) => [l.csv_line, l.worker, l.total_hours, l.fringe_6b]),
      o.plan_totals, o.plan_totals_sum, o.fringe_column_6b_sum, o.reconciles,
    ]);
    assert.equal(pick(js), pick(go));
    assert.equal(js.reconciles, c.exit_status === 0);
  });
}

for (const c of golden.pto) {
  test(`pto_accrual = pto.ComputeBalance: ${c.name}`, () => {
    assert.equal(JSON.stringify(ptoAccrual(c.input)), c.output);
  });
}

test("usFederalHolidays = pto.USFederalHolidays", () => {
  const go = JSON.parse(golden.us_federal_holidays);
  const js = Object.fromEntries(Object.keys(go).map((y) => [y, usFederalHolidays(Number(y))]));
  assert.equal(JSON.stringify(js), golden.us_federal_holidays);
});

test("enough golden cases", () => {
  assert.ok(golden.wh347.length + golden.pto.length >= 20);
});

test("invalid input is rejected", () => {
  assert.throws(() => payrollLines({ workers: [] }));
  assert.throws(() => payrollLines({ workers: [{ base_rate: -1 }] }));
  assert.throws(() => payrollLines({ workers: [{ type: "X" }] }));
  assert.throws(() => payrollLines({ workers: [{ st_hours: [1, 1, 1, 1, 1, 1, 1, 1] }] }));
  const p = { policy: { period: "monthly", rate: 1, annual_cap: 12, carryover_max: 0 }, hire_date: "2026-01-01" };
  assert.throws(() => ptoAccrual({ ...p, as_of: "2026-02-30" }), /not a valid/);
  assert.throws(() => ptoAccrual({ ...p, as_of: "2026-2-3" }));
});
