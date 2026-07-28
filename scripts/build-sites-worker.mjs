import { copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";

const projectRoot = resolve(import.meta.dirname, "..");
const workerDirectory = resolve(projectRoot, "dist/server");
const hostingDirectory = resolve(projectRoot, "dist/.openai");

await Promise.all([
  mkdir(workerDirectory, { recursive: true }),
  mkdir(hostingDirectory, { recursive: true })
]);

await build({
  entryPoints: [resolve(projectRoot, "server/sites-worker.ts")],
  outfile: resolve(workerDirectory, "index.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  sourcemap: true,
  legalComments: "eof"
});

let copiedHostingConfig = false;
try {
  await copyFile(
    resolve(projectRoot, ".openai/hosting.json"),
    resolve(hostingDirectory, "hosting.json")
  );
  copiedHostingConfig = true;
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

console.log(
  copiedHostingConfig
    ? "Prepared Sites edge entrypoint and local hosting config in dist/"
    : "Prepared Sites edge entrypoint in dist/server/index.js"
);
