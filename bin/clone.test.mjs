import assert from "node:assert/strict";
import { test } from "node:test";

import {
  banner,
  KIT_TOKEN,
  kebab,
  renderPlan,
  sanitiseDocs,
  sanitisePackageJson,
  sanitiseWrangler,
  STRIP_PATHS,
  ZERO_ACCOUNT_ID,
  ZERO_DATABASE_ID,
} from "./clone.mjs";

test("clone: names normalise to kebab-case", () => {
  assert.equal(kebab("My Project"), "my-project");
  assert.equal(kebab("order_history"), "order-history");
  assert.equal(kebab("  x  "), "x");
});

test("clone: the plan names every strip path and the target name", () => {
  const plan = renderPlan({
    name: "demo-kit",
    ref: "main",
    target: "/tmp/demo",
  });

  for (const path of STRIP_PATHS) assert.ok(plan.includes(path), path);
  assert.match(plan, /"cf-core-kit" -> "demo-kit"/);
  assert.match(plan, /keep README\.md, _template\.md/);
});

test("clone: package.json is renamed and de-referenced", () => {
  const source = JSON.stringify({
    name: "cf-core-kit",
    version: "0.0.0",
    repository: { url: "x" },
    license: "MIT",
  });
  const next = JSON.parse(sanitisePackageJson(source, "demo-kit"));

  assert.equal(next.name, "demo-kit");
  assert.equal(next.version, "0.1.0");
  assert.equal(next.description, `Generated from ${KIT_TOKEN}`);
  assert.equal(next.repository, undefined);
  assert.equal(next.license, "MIT");
});

test("clone: wrangler ids are zeroed and the kit token renamed", () => {
  const source =
    '{"name":"cf-core-kit","vars":{"R2_ACCOUNT_ID":"64cebf25"},"d1_databases":[{"database_id":"a59bcaa8"}]}';
  const next = sanitiseWrangler(source, "demo-kit");

  const parsed = JSON.parse(next);

  assert.equal(parsed.d1_databases[0].database_id, ZERO_DATABASE_ID);
  assert.equal(parsed.vars.R2_ACCOUNT_ID, ZERO_ACCOUNT_ID);
  assert.equal(parsed.name, "demo-kit");
  assert.ok(!next.includes("64cebf25"));
  assert.ok(!next.includes("a59bcaa8"));
  assert.ok(!next.includes(KIT_TOKEN));
});

test("clone: docs are renamed and the banner records provenance", () => {
  assert.equal(
    sanitiseDocs("see cf-core-kit/docs", "demo-kit"),
    "see demo-kit/docs",
  );
  assert.match(
    banner("demo-kit", "3be40ca1234"),
    /Generated from `cf-core-kit@3be40ca`/,
  );
});
