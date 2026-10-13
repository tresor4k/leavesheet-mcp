// Stdio smoke test: start the server, list the tools, call each one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const server = fileURLToPath(new URL("../src/index.js", import.meta.url));
const WH347_URL = "https://tabletemplates.com/certified-payroll-software/";
const PTO_URL = "https://tabletemplates.com/pto-tracking-software/";

test("stdio: list and call the 3 tools", async () => {
  const client = new Client({ name: "smoke", version: "0.0.0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [server] }));
  try {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), ["pto_accrual", "wh347_fringe_reconcile", "wh347_payroll_lines"]);

    const crew = {
      workers: [{
        worker: "John Mason", type: "J", base_rate: 30, fringe_health_welfare: 4, fringe_pension: 2,
        st_hours: [8, 8, 8, 8, 8], ot_hours: [4], other_deductions: 310,
      }],
    };
    const call = async (name, args) => {
      const r = await client.callTool({ name, arguments: args });
      assert.ok(!r.isError, r.content?.[0]?.text);
      return JSON.parse(r.content[0].text);
    };

    const lines = await call("wh347_payroll_lines", crew);
    assert.equal(lines.lines[0].gross_project_7a, 1380);
    assert.equal(lines.lines[0].net_pay_9, 1070);
    assert.equal(lines.reference_url, WH347_URL);
    assert.match(lines.disclaimer, /not legal or payroll advice/);
    assert.ok(lines.source);

    const rec = await call("wh347_fringe_reconcile", crew);
    assert.equal(rec.fringe_column_6b_sum, 264);
    assert.equal(rec.reconciles, true);
    assert.equal(rec.reference_url, WH347_URL);

    const ptoArgs = {
      policy: { period: "monthly", rate: 1.25, annual_cap: 15, carryover_max: 5 },
      hire_date: "2026-03-15", as_of: "2026-06-30", carryover: 3,
    };
    const pto = await call("pto_accrual", ptoArgs);
    assert.equal(pto.balance.left, 8);
    assert.equal(pto.reference_url, PTO_URL);
    assert.match(pto.disclaimer, /not legal or payroll advice/);

    const bad = await client.callTool({ name: "pto_accrual", arguments: { ...ptoArgs, as_of: "2026-02-30" } });
    assert.equal(bad.isError, true);
  } finally {
    await client.close();
  }
});
