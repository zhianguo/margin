import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const manifestPath = resolve(
  projectRoot,
  "test/fixtures/public-pdfs.json"
);
const fixtures = JSON.parse(await readFile(manifestPath, "utf8"));
const requestedId = process.argv[2] ?? fixtures[0]?.id;
const fixture = fixtures.find(({ id }) => id === requestedId);

if (!fixture) {
  const available = fixtures.map(({ id }) => id).join(", ");
  throw new Error(
    `Unknown public PDF fixture "${requestedId}". Available fixtures: ${available}`
  );
}

const cachePath = resolve(projectRoot, fixture.cachePath);
if (
  cachePath === projectRoot ||
  !cachePath.startsWith(`${projectRoot}${sep}`)
) {
  throw new Error(`Fixture cache path escapes the project: ${fixture.cachePath}`);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function readVerifiedCache() {
  try {
    const bytes = await readFile(cachePath);
    return sha256(bytes) === fixture.sha256;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

if (await readVerifiedCache()) {
  console.log(relative(projectRoot, cachePath));
  process.exit(0);
}

const response = await fetch(fixture.sourceUrl, {
  redirect: "follow",
  headers: {
    Accept: "application/pdf",
    "User-Agent": "Margin/0.1 public-fixture downloader"
  }
});

if (!response.ok) {
  throw new Error(
    `Could not download ${fixture.id}: HTTP ${response.status}`
  );
}

const maximumBytes = 25 * 1024 * 1024;
const declaredBytes = Number(response.headers.get("content-length") ?? 0);
if (Number.isFinite(declaredBytes) && declaredBytes > maximumBytes) {
  throw new Error(`Public PDF fixture exceeds ${maximumBytes} bytes.`);
}

const bytes = Buffer.from(await response.arrayBuffer());
if (bytes.byteLength > maximumBytes) {
  throw new Error(`Public PDF fixture exceeds ${maximumBytes} bytes.`);
}
if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
  throw new Error("Public PDF fixture response is not a PDF.");
}

const digest = sha256(bytes);
if (digest !== fixture.sha256) {
  throw new Error(
    `Checksum mismatch for ${fixture.id}: expected ${fixture.sha256}, received ${digest}`
  );
}

await mkdir(dirname(cachePath), { recursive: true });
await writeFile(cachePath, bytes);
console.log(relative(projectRoot, cachePath));
