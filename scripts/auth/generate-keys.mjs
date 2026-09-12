import { generateKeyPairSync, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

export function generateSigningKeySet() {
  const { privateKey } = generateKeyPairSync("ed25519");
  const jwk = privateKey.export({ format: "jwk" });

  return { ...jwk, kid: randomUUID(), alg: "EdDSA", use: "sig" };
}

export function renderDevVars(keySet) {
  const json = JSON.stringify([keySet]);

  return { json, base64: Buffer.from(json, "utf8").toString("base64") };
}

function main() {
  const { json, base64 } = renderDevVars(generateSigningKeySet());

  console.log("# Local auth signing keys - never commit private material.");
  console.log(
    "# .dev.vars (local) or `npx wrangler secret put AUTH_SIGNING_KEYS_JSON` (deployed):",
  );
  console.log(`AUTH_SIGNING_KEYS_JSON=${json}`);
  console.log(`AUTH_SIGNING_KEYS_JSON_BASE64=${base64}`);
}

const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main();
}
