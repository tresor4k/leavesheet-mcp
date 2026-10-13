#!/usr/bin/env node
// leavesheet-mcp — MCP stdio server exposing the WH-347 certified payroll and
// PTO accrual calculations of TableTemplates / LeaveSheet (tabletemplates.com).
// The engines are a line-by-line port of the open-source Go packages
// codeberg.org/tresor2k/tabletemplates-go (wh347, pto, cmd/wh347).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { crewShape, ptoShape, payrollLines, fringeReconcile, ptoAccrual } from "./tools.js";

const VERSION = "0.1.0";
const DISCLAIMER = "Calculator output only: not legal or payroll advice, not an official DOL tool.";
const WH347 = {
  source: "TableTemplates LeaveSheet WH-347 engine (port of codeberg.org/tresor2k/tabletemplates-go/wh347)",
  reference_url: "https://tabletemplates.com/certified-payroll-software/",
  disclaimer: DISCLAIMER,
};
const PTO = {
  source: "TableTemplates LeaveSheet PTO engine (port of codeberg.org/tresor2k/tabletemplates-go/pto)",
  reference_url: "https://tabletemplates.com/pto-tracking-software/",
  disclaimer: "Calculator output only: not legal or payroll advice; state paid-leave laws are not encoded.",
};

function reply(fn, meta) {
  return async (args) => {
    try {
      return { content: [{ type: "text", text: JSON.stringify({ ...fn(args), ...meta }, null, 2) }] };
    } catch (e) {
      return { isError: true, content: [{ type: "text", text: String(e?.message ?? e) }] };
    }
  };
}

const server = new McpServer({ name: "leavesheet-mcp", version: VERSION });

server.registerTool(
  "wh347_payroll_lines",
  {
    title: "WH-347 columns 5-9 for a crew week",
    description:
      "Computes columns 2 and 5-9 of the U.S. DOL WH-347 certified payroll form (Rev. January 2025) for " +
      "one project and one payroll week: hours, 6A rates (OT = base x 1.5), 6B fringe credit, 6C cash in " +
      "lieu, 7A/7B gross, 8 deductions, 9 net pay, plus fringe paid to each plan and the 6B reconciliation. " +
      "Amounts are rounded to cents for output only. Same JSON as the `wh347 --json` command. " +
      'Example: { "workers": [{ "worker": "John Mason", "type": "J", "base_rate": 30, ' +
      '"fringe_health_welfare": 4, "fringe_pension": 2, "st_hours": [8,8,8,8,8], "ot_hours": [4], ' +
      '"other_deductions": 310 }] }.',
    inputSchema: crewShape,
  },
  reply(payrollLines, WH347),
);

server.registerTool(
  "wh347_fringe_reconcile",
  {
    title: "WH-347 column 6B fringe reconciliation",
    description:
      "Checks that the sum of column 6B (total hours x total fringe $/h, per worker) equals the fringe paid " +
      "to the four plans (health and welfare, pension, vacation/holiday, training: total hours x plan rate). " +
      "reconciles = |sum of 6B - sum of plans| < 0.005. Takes the same worker entries as wh347_payroll_lines " +
      "(only hours and fringe rates matter here).",
    inputSchema: crewShape,
  },
  reply(fringeReconcile, WH347),
);

server.registerTool(
  "pto_accrual",
  {
    title: "PTO balance (accrual, tiers, cap, carryover)",
    description:
      "Computes a paid-time-off balance in days at an as-of date: months worked this year (hire month counts " +
      "in full), years of service (days / 365), effective rate after tenure tiers (tier 2 replaces tier 1), " +
      "accrued days capped at the annual cap (monthly accrual or annual front-loaded grant prorated in the hire " +
      "year), carryover capped at the policy maximum, approved leave taken (Monday-Friday workdays minus " +
      "holidays, half days) and pending leave. left = carryover + accrued - taken, may be negative. " +
      "No rounding. Year boundary: accrual restarts on January 1; the carryover is the value you enter.",
    inputSchema: ptoShape,
  },
  reply(ptoAccrual, PTO),
);

await server.connect(new StdioServerTransport());
