import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";

const trackedFiles = execFileSync("git", ["ls-files", "-z"], {
  encoding: "utf8"
})
  .split("\0")
  .filter(Boolean);

const allowedEnvironmentFiles = new Set([
  ".env.example",
  ".env.llamacpp.example",
  ".env.gemini.example",
  ".env.openai-compatible.example"
]);
const allowedPdfFiles = new Set(["public/demo-paper.pdf"]);
const binaryExtensions = new Set([
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".pdf",
  ".png",
  ".webp",
  ".woff",
  ".woff2"
]);
const violations = [];

for (const file of trackedFiles) {
  const basename = file.split("/").at(-1) ?? file;
  const lowerBasename = basename.toLowerCase();

  if (file === ".openai/hosting.json") {
    violations.push(`${file}: local deployment metadata must not be published`);
  }
  if (
    lowerBasename.startsWith(".env") &&
    !allowedEnvironmentFiles.has(file)
  ) {
    violations.push(`${file}: environment configuration is not allowlisted`);
  }
  if (
    [".envrc", ".netrc", ".npmrc", ".pgpass", ".pypirc"].includes(
      lowerBasename
    )
  ) {
    violations.push(`${file}: credential-capable configuration is tracked`);
  }
  if (/\.(key|p12|pem|pfx)$/i.test(file)) {
    violations.push(`${file}: key or certificate material is tracked`);
  }
  if (/(^|\/)(credentials|secrets)[^/]*\.json$/i.test(file)) {
    violations.push(`${file}: credential or secret data is tracked`);
  }
  if (
    extname(file).toLowerCase() === ".pdf" &&
    !allowedPdfFiles.has(file)
  ) {
    violations.push(`${file}: PDF is not on the public fixture allowlist`);
  }

  if (binaryExtensions.has(extname(file).toLowerCase())) continue;

  const text = await readFile(file, "utf8");
  const privateKeyMarker = ["-----BEGIN ", "PRIVATE KEY-----"].join("");
  const checks = [
    {
      pattern: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu,
      message: "email address found in tracked content"
    },
    {
      pattern: /(?:^|[\s"'(])\/(?:home|Users)\/[^/\s]+/u,
      message: "absolute user home path found in tracked content"
    },
    {
      pattern: /https?:\/\/[^/\s:@]+:[^/\s@]+@/iu,
      message: "credential-bearing URL found in tracked content"
    },
    {
      pattern: /AKIA[0-9A-Z]{16}/u,
      message: "AWS access-key pattern found in tracked content"
    },
    {
      pattern: /gh[pousr]_[A-Za-z0-9]{36,255}/u,
      message: "GitHub token pattern found in tracked content"
    },
    {
      pattern: /sk-[A-Za-z0-9_-]{20,}/u,
      message: "API-key pattern found in tracked content"
    }
  ];

  if (text.includes(privateKeyMarker)) {
    violations.push(`${file}: private-key marker found in tracked content`);
  }
  for (const { pattern, message } of checks) {
    if (pattern.test(text)) violations.push(`${file}: ${message}`);
  }
}

if (violations.length > 0) {
  console.error("Public snapshot check failed:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
} else {
  console.log(
    `Public snapshot check passed (${trackedFiles.length} tracked files).`
  );
}
