import assert from "node:assert/strict";
import { test } from "node:test";

import {
  checkClassification,
  checkEmitDrift,
  checkErrorCodeVocabulary,
  checkParity,
  collectOperations,
  compareOperationShapes,
  matchPattern,
  sha256,
  verifyProvenance,
  verifyProvenanceShape,
} from "./check.mjs";

const CONTENT = Buffer.from("hello");
const BASE = {
  artifact: "contracts/backend.openapi.yaml",
  sha256: sha256(CONTENT),
  bytes: CONTENT.byteLength,
  pinnedAt: "2026-10-11",
  source: {
    repo: "backend-core-kit",
    branch: "development",
    commit: "670d9bc62e6ac3c0a5d1dc5dec3a9900b1840aa1",
    path: "docs/openapi/openapi.yaml",
    version: "0.1.0",
  },
};

test("provenance: matching hash and byte size pass", () => {
  assert.equal(verifyProvenance(BASE, CONTENT).length, 0);
});

test("provenance: tampered artifact fails with a sha256 mismatch", () => {
  const violations = verifyProvenance(BASE, Buffer.from("HELLO"));

  assert.equal(violations.length, 1);
  assert.match(violations[0].detail, /sha256 mismatch/);
});

test("provenance: byte size drift is named explicitly", () => {
  const violations = verifyProvenance(BASE, Buffer.from("hello!"));

  assert.equal(violations.length, 2);
  assert.match(violations[1].detail, /byte size mismatch/);
});

test("provenance: a missing artifact fails", () => {
  const violations = verifyProvenance(BASE, undefined);

  assert.equal(violations.length, 1);
  assert.match(violations[0].detail, /missing/);
});

test("provenance: shape gaps are named per field", () => {
  const broken = { ...BASE, source: { ...BASE.source, commit: undefined } };
  const violations = verifyProvenanceShape(broken);

  assert.equal(violations.length, 1);
  assert.match(violations[0].detail, /source\.commit/);
});

test("provenance: non-object and missing source blocks fail", () => {
  assert.equal(verifyProvenanceShape(null).length, 1);
  assert.equal(verifyProvenanceShape({ artifact: "x" }).length >= 1, true);
});

test("emit drift: identical content passes", () => {
  assert.equal(
    checkEmitDrift({ emitted: "a", committed: "a", error: undefined }).length,
    0,
  );
});

test("emit drift: stale content fails with the regenerate hint", () => {
  const violations = checkEmitDrift({
    emitted: "a",
    committed: "b",
    error: undefined,
  });

  assert.equal(violations.length, 1);
  assert.match(violations[0].detail, /contract:emit/);
});

test("emit drift: missing committed snapshot fails", () => {
  const violations = checkEmitDrift({
    emitted: "a",
    committed: undefined,
    error: undefined,
  });

  assert.equal(violations.length, 1);
  assert.match(violations[0].detail, /missing/);
});

test("emit drift: an emitter error is reported as such", () => {
  const violations = checkEmitDrift({
    emitted: undefined,
    committed: "b",
    error: "boom",
  });

  assert.equal(violations.length, 1);
  assert.match(violations[0].detail, /emit failed: boom/);
});

const MANIFEST = { implemented: ["thing.get"], pending: [], descoped: [] };

const SNAPSHOT_DOCUMENT = {
  paths: {
    "/thing": {
      get: {
        operationId: "thing.get",
        tags: ["Thing"],
        "x-error-codes": ["INTERNAL"],
        responses: {
          200: {
            description: "ok",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Thing" },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Thing: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
  },
};

const EMITTED_DOCUMENT = {
  paths: {
    "/thing": {
      get: {
        operationId: "thing.get",
        tags: ["Thing"],
        "x-error-codes": ["INTERNAL"],
        responses: {
          200: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { id: { type: "string" } },
                  required: ["id"],
                },
              },
            },
          },
        },
      },
    },
  },
};

test("parity: collectOperations walks operations only", () => {
  const ids = collectOperations(SNAPSHOT_DOCUMENT).map(
    (entry) => entry.operationId,
  );

  assert.deepEqual(ids, ["thing.get"]);
});

test("parity: wildcard patterns match by prefix", () => {
  assert.equal(matchPattern("auth.password.*", "auth.password.login"), true);
  assert.equal(matchPattern("health.get", "health.get"), true);
  assert.equal(matchPattern("health.get", "ready.get"), false);
});

test("parity: a complete, disjoint classification passes", () => {
  assert.equal(checkClassification(["thing.get"], MANIFEST).length, 0);
});

test("parity: unclassified operations fail", () => {
  const violations = checkClassification(["thing.get", "other.get"], MANIFEST);

  assert.equal(
    violations.some((entry) =>
      /operation not classified: other.get/.test(entry.detail),
    ),
    true,
  );
});

test("parity: double classification and stale patterns fail", () => {
  const doubled = checkClassification(["thing.get"], {
    implemented: ["thing.get"],
    pending: ["thing.get"],
    descoped: [],
  });
  assert.equal(
    doubled.some((entry) => /classified twice/.test(entry.detail)),
    true,
  );

  const stale = checkClassification(["thing.get"], {
    implemented: ["thing.get"],
    pending: ["ghost.get"],
    descoped: [],
  });
  assert.equal(
    stale.some((entry) => /matches no snapshot operation/.test(entry.detail)),
    true,
  );
});

test("parity: descoped entries require reason, revisit, and adr", () => {
  const violations = checkClassification(["thing.get"], {
    implemented: ["thing.get"],
    pending: [],
    descoped: [{ operations: ["thing.get"], reason: "r", revisit: "v" }],
  });

  assert.equal(
    violations.some((entry) => /missing adr/.test(entry.detail)),
    true,
  );
});

test("parity: $ref-resolved shapes compare equal", () => {
  const violations = checkParity({
    snapshotDocument: SNAPSHOT_DOCUMENT,
    emittedDocument: EMITTED_DOCUMENT,
    manifest: MANIFEST,
  });

  assert.deepEqual(violations, []);
});

test("parity: response schema drift fails", () => {
  const drifted = structuredClone(EMITTED_DOCUMENT);
  drifted.paths["/thing"].get.responses["200"].content[
    "application/json"
  ].schema.properties.id.type = "number";

  const violations = checkParity({
    snapshotDocument: SNAPSHOT_DOCUMENT,
    emittedDocument: drifted,
    manifest: MANIFEST,
  });

  assert.equal(
    violations.some((entry) => /response schema drift/.test(entry.detail)),
    true,
  );
});

test("parity: cosmetic copy and single-branch allOf do not fail", () => {
  const restyled = structuredClone(EMITTED_DOCUMENT);
  restyled.paths["/thing"].get.responses["200"].content[
    "application/json"
  ].schema = {
    description: "A different description",
    allOf: [
      {
        type: "object",
        properties: { id: { type: "string", example: "renamed-example" } },
        required: ["id"],
      },
    ],
  };

  const violations = checkParity({
    snapshotDocument: SNAPSHOT_DOCUMENT,
    emittedDocument: restyled,
    manifest: MANIFEST,
  });

  assert.deepEqual(violations, []);
});

test("parity: nullable remains structural", () => {
  const drifted = structuredClone(EMITTED_DOCUMENT);
  drifted.paths["/thing"].get.responses["200"].content[
    "application/json"
  ].schema.nullable = true;

  const violations = checkParity({
    snapshotDocument: SNAPSHOT_DOCUMENT,
    emittedDocument: drifted,
    manifest: MANIFEST,
  });

  assert.equal(
    violations.some((entry) => /response schema drift/.test(entry.detail)),
    true,
  );
});

test("vocabulary: declared codes pass the snapshot check", () => {
  const source = 'INTERNAL = "INTERNAL";';

  assert.deepEqual(checkErrorCodeVocabulary(SNAPSHOT_DOCUMENT, source), []);
});

test("vocabulary: undeclared codes fail with the file named", () => {
  const violations = checkErrorCodeVocabulary(
    SNAPSHOT_DOCUMENT,
    'GHOST_CODE = "GHOST_CODE";',
  );

  assert.equal(violations.length, 1);
  assert.match(violations[0].detail, /GHOST_CODE/);
  assert.equal(violations[0].file, "src/shared/error-codes.ts");
});

test("parity: empty containers normalize away", () => {
  const operation = (items) => ({
    paths: {
      "/x": {
        get: {
          operationId: "x.get",
          responses: {
            200: {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { keys: { type: "array", items } },
                    required: ["keys"],
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  const manifest = { implemented: ["x.get"], pending: [], descoped: [] };

  const violations = checkParity({
    snapshotDocument: operation({ type: "object" }),
    emittedDocument: operation({
      type: "object",
      properties: {},
      required: [],
    }),
    manifest,
  });

  assert.deepEqual(violations, []);
});

test("parity: error-code drift fails", () => {
  const drifted = structuredClone(EMITTED_DOCUMENT);
  drifted.paths["/thing"].get["x-error-codes"] = ["NOT_FOUND"];

  const [snapshotOperation] = collectOperations(SNAPSHOT_DOCUMENT);
  const [emittedOperation] = collectOperations(drifted);
  const violations = compareOperationShapes({
    snapshotOperation,
    emittedOperation,
    snapshotDocument: SNAPSHOT_DOCUMENT,
    emittedDocument: drifted,
  });

  assert.equal(
    violations.some((entry) => /x-error-codes differ/.test(entry.detail)),
    true,
  );
});

test("parity: emitted operations must be declared implemented", () => {
  const violations = checkParity({
    snapshotDocument: SNAPSHOT_DOCUMENT,
    emittedDocument: EMITTED_DOCUMENT,
    manifest: { implemented: [], pending: ["thing.get"], descoped: [] },
  });

  assert.equal(
    violations.some((entry) => /not declared implemented/.test(entry.detail)),
    true,
  );
});

test("parity: implemented operations missing from the emitted snapshot fail", () => {
  const violations = checkParity({
    snapshotDocument: SNAPSHOT_DOCUMENT,
    emittedDocument: { paths: {} },
    manifest: MANIFEST,
  });

  assert.equal(
    violations.some((entry) =>
      /missing from emitted snapshot/.test(entry.detail),
    ),
    true,
  );
});
