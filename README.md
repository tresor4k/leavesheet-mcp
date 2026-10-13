# leavesheet-mcp

MCP server (stdio) for two payroll calculations used by
[LeaveSheet / TableTemplates](https://tabletemplates.com/certified-payroll-software/):

- U.S. DOL **WH-347** certified payroll form, revised version (Rev. January 2025):
  columns 2 and 5-9 for a crew week, fringe paid to each plan, column 6B reconciliation.
- **PTO accrual**: leave balance at a date, with hire date, annual cap, tenure tiers,
  carryover cap, approved and pending requests, holidays and half days.

The calculations are a line-by-line JavaScript port of the open-source Go packages
`codeberg.org/tresor2k/tabletemplates-go/wh347`, `.../pto` and the `wh347` command
(`.../cmd/wh347`). The test suite checks the output byte for byte against those Go
engines on 28 golden cases. No network access, no data stored.

## Install

Requires Node.js 22 or later.

```json
{
  "mcpServers": {
    "leavesheet": { "command": "npx", "args": ["-y", "leavesheet-mcp"] }
  }
}
```

## Tools

| Tool | What it returns |
| --- | --- |
| `wh347_payroll_lines` | Per worker: ST/OT/total hours (col. 5), 6A rates (OT = base x 1.5), 6B fringe credit, 6C cash in lieu, 7A gross for the project, 7B gross for all work, 8 deductions, 9 net pay, sanity flag; crew totals per fringe plan and the 6B reconciliation. Same JSON as `wh347 --json`. |
| `wh347_fringe_reconcile` | Sum of column 6B vs. fringe paid to the four plans (health and welfare, pension, vacation/holiday, training); `reconciles` when the gap is under 0.005. |
| `pto_accrual` | Months worked this year, years of service, effective rate, accrued days (capped), carryover (capped), days taken, days pending, days left, plus the workdays of each request. |

### Inputs

`wh347_payroll_lines` and `wh347_fringe_reconcile` take `{ "workers": [...] }`, one entry
per worker-week on one project. Field names follow the CSV columns of the `wh347`
command: `worker`, `type` (`J`, `RA` or empty), `base_rate`, `fringe_health_welfare`,
`fringe_pension`, `fringe_vacation`, `fringe_training`, `st_hours` and `ot_hours`
(arrays of up to 7 daily values), `cash_in_lieu_rate`, `gross_all_work` (column 7B;
omit it to use 7A), `fica`, `federal_tax`, `state_tax`, `other_deductions`. Omitted
numbers are 0; negative numbers are rejected. `csv_line` in the output is the line
the worker would have in the equivalent CSV (header = line 1).

`pto_accrual` takes `policy` (`period`: `monthly` or `annual`, `rate`, `annual_cap`,
`carryover_max`, optional `tier1_years`/`tier1_bonus`, `tier2_years`/`tier2_bonus`),
`hire_date`, `as_of`, `carryover`, `requests` (`start`, `end`, `start_half`,
`end_half`, `status`: `pending`, `approved`, `denied` or `cancelled`), `holidays`
(dates) and `us_federal_holidays_years` (adds the 11 U.S. federal holidays, observed
dates, of the listed years). Dates are `YYYY-MM-DD`.

## Example

`wh347_payroll_lines` input:

```json
{ "workers": [{ "worker": "John Mason", "type": "J", "base_rate": 30,
  "fringe_health_welfare": 4, "fringe_pension": 2,
  "st_hours": [8, 8, 8, 8, 8], "ot_hours": [4], "other_deductions": 310 }] }
```

Output:

```json
{
  "form": "WH-347 (Rev. January 2025)",
  "lines": [
    {
      "csv_line": 2,
      "worker": "John Mason",
      "worker_type": "J",
      "st_hours": 40,
      "ot_hours": 4,
      "total_hours": 44,
      "rate_6a_st": 30,
      "rate_6a_ot": 45,
      "fringe_6b": 264,
      "cash_in_lieu_6c": 0,
      "gross_project_7a": 1380,
      "gross_all_work_7b": 1380,
      "gross_all_work_7b_entered": false,
      "deductions_8": 310,
      "net_pay_9": 1070,
      "sanity": "ok"
    }
  ],
  "plan_totals": { "health_welfare": 176, "pension": 88, "vacation": 0, "training": 0 },
  "plan_totals_sum": 264,
  "fringe_column_6b_sum": 264,
  "reconciles": true,
  "source": "TableTemplates LeaveSheet WH-347 engine (port of codeberg.org/tresor2k/tabletemplates-go/wh347)",
  "reference_url": "https://tabletemplates.com/certified-payroll-software/",
  "disclaimer": "Calculator output only: not legal or payroll advice, not an official DOL tool."
}
```

`pto_accrual` with a monthly policy of 1.25 days (+0.25 after 2 years, cap 15,
carryover cap 5), hired 2023-04-03, 9 days carried over, one approved request from
2026-06-29 to 2026-07-07 and the 2026 federal holidays, as of 2026-07-31:

```json
{
  "balance": {
    "months_worked": 7,
    "years_of_service": 3.328767123287671,
    "effective_rate": 1.5,
    "accrued": 10.5,
    "carryover": 5,
    "taken": 6,
    "pending": 0,
    "left": 9.5,
    "is_negative": false
  },
  "request_days": [6],
  "source": "TableTemplates LeaveSheet PTO engine (port of codeberg.org/tresor2k/tabletemplates-go/pto)",
  "reference_url": "https://tabletemplates.com/pto-tracking-software/",
  "disclaimer": "Calculator output only: not legal or payroll advice; state paid-leave laws are not encoded."
}
```

(July 3, 2026 is the observed Independence Day, so the 7 weekdays of the request count as 6.)

## Limits

- Not an official DOL tool, not legal or payroll advice. The WH-347 tool does not
  look up prevailing wage rates, classify work, or compute taxes: rates and deductions
  are entered. The ST/OT split is entered, not computed.
- WH-347 amounts are rounded to cents in the output only (halves toward +infinity),
  never inside the calculation. PTO values are not rounded.
- PTO: month-granular accrual (the hire month counts in full), years of service =
  days / 365, accrual restarts on January 1; the carryover is the value you enter,
  capped by the policy. State paid-leave laws are not encoded; the only built-in
  holidays are the U.S. federal ones.

## Development

```sh
npm install
npm test                      # parity with the Go engines + stdio smoke test
node scripts/gen-golden.mjs   # regenerate test/golden.json (needs Go 1.24 and the Go sources)
```

License: MIT.
