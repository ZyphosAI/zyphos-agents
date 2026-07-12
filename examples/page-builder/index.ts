/**
 * page-builder — generate a UI definition from a plain English prompt.
 *
 * The PageBuilder sends your description to Claude and receives back
 * a JSON schema describing React components — no actual JSX is generated.
 * Any frontend can interpret the schema to render the appropriate components.
 *
 * Run:
 *   cd zyphos-agents
 *   ANTHROPIC_API_KEY=sk-ant-... npx ts-node examples/page-builder/index.ts
 */

import { PageBuilder } from "../../packages/builder/src";

async function main() {
  // 1. Create a PageBuilder.
  //    It picks up your ANTHROPIC_API_KEY from the environment automatically.
  const builder = new PageBuilder({
    model: "claude-sonnet-4-5", // use the full model for richer output
    maxTokens: 2_048,
  });

  // ── Example 1: Data table with search ─────────────────────────────────────

  console.log("Generating: Employee table with search…\n");

  // 2. Call builder.generate() with a plain English UI description.
  //    You don't write any code — just describe what you want.
  const tablePage = await builder.generate(
    "A page showing a searchable table of employees with columns for " +
      "name, department, job title, salary, and employment status. " +
      "Include buttons to Add Employee and Export CSV."
  );

  // 3. The result is a structured JSON schema — not JSX.
  //    Your React app can render it dynamically using a component registry.
  console.log("═══ Employee Table Definition ═══");
  console.log("Title:", tablePage.title);
  console.log("Components:", tablePage.components.length);
  for (const component of tablePage.components) {
    console.log(`  • [${component.type}] ${component.label ?? ""}`);
    if (component.columns) {
      console.log(
        "    Columns:",
        component.columns.map((c) => c.label).join(", ")
      );
    }
    if (component.actions) {
      console.log(
        "    Actions:",
        component.actions.map((a) => a.label).join(", ")
      );
    }
  }
  console.log("\nFull schema (first component):");
  console.log(JSON.stringify(tablePage.components[0], null, 2));

  // ── Example 2: Analytics dashboard ───────────────────────────────────────

  console.log("\n\nGenerating: Analytics dashboard…\n");

  const dashPage = await builder.generate(
    "An analytics dashboard with metric cards showing total revenue, " +
      "active users, and churn rate, followed by a line chart of monthly " +
      "revenue for the past 12 months, and a table of top 5 customers by spend."
  );

  console.log("═══ Dashboard Definition ═══");
  console.log("Title:", dashPage.title);
  console.log("Generated at:", dashPage.generatedAt);
  console.log("Components defined:", dashPage.components.length);

  for (const c of dashPage.components) {
    console.log(`  [${c.type}]`, c.label ?? "", c.description ? `— ${c.description}` : "");
  }

  // ── How to use the schema in your React app ───────────────────────────────

  console.log(`
═══ How to render in React ═══

The PageDefinition returned by builder.generate() is pure JSON — no runtime
dependency on zyphos-agents in your frontend. Wire it up like this:

  import { PageBuilder } from "@zyphos/builder";           // server-side only
  import { ComponentRenderer } from "./ComponentRenderer"; // your own renderer

  // Server: generate once, cache, serve as JSON
  const schema = await builder.generate("A table of orders");

  // Client: render from the schema
  function Page({ schema }) {
    return schema.components.map((def, i) => (
      <ComponentRenderer key={i} definition={def} />
    ));
  }

Your ComponentRenderer maps "type" values to real React components:
  "Table"   → <DataTable columns={def.columns} ... />
  "Card"    → <MetricCard {...def.props} />
  "Chart"   → <LineChart {...def.props} />
  "Form"    → <AutoForm fields={def.columns} ... />
`);
}

main().catch(console.error);
