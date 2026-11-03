import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const errors = [];

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (["data", "node_modules"].includes(entry.name)) return [];
      return walk(path);
    }
    return [path];
  });
}

for (const file of walk(root)) {
  if (file.endsWith(".json")) {
    try {
      JSON.parse(readFileSync(file, "utf8"));
    } catch (error) {
      errors.push(`${relative(root, file)}: ${error.message}`);
    }
  }
  if (file.endsWith(".js") || file.endsWith(".mjs")) {
    const checked = spawnSync(process.execPath, ["--check", file], {
      encoding: "utf8",
    });
    if (checked.status !== 0) {
      errors.push(`${relative(root, file)}: ${checked.stderr.trim()}`);
    }
  }
}

const miniappRoot = join(root, "apps", "miniapp");
const appConfig = JSON.parse(
  readFileSync(join(miniappRoot, "app.json"), "utf8"),
);
for (const page of appConfig.pages) {
  for (const extension of [".js", ".json", ".wxml", ".wxss"]) {
    const pageFile = join(miniappRoot, `${page}${extension}`);
    try {
      if (!statSync(pageFile).isFile()) {
        errors.push(`${page}${extension}: missing page file`);
      }
    } catch {
      errors.push(`${page}${extension}: missing page file`);
    }
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Static validation passed");
}
