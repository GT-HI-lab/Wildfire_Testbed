import { cp, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(root, "dist");
const publicDirectories = ["client", "server", "shared"];
const allowedExtensions = new Set([".html", ".css", ".js", ".svg"]);
const files = [];
async function collect(directory) {
  for (const entry of await readdir(resolve(root, directory), { withFileTypes: true })) {
    const name = `${directory}/${entry.name}`;
    if (entry.name.startsWith(".") || entry.name === "env.js") continue;
    if (entry.isDirectory()) await collect(name);
    else if (allowedExtensions.has(extname(name))) files.push(name);
  }
}
for (const directory of publicDirectories) await collect(directory);
// Check local module, stylesheet, image and HTML references before publishing.
for (const name of files) {
  const source = await readFile(resolve(root, name), "utf8");
  const references = [
    ...source.matchAll(/(?:\bfrom\s*|\bimport\s*)["'](\.[^"']+)["']/g),
    ...source.matchAll(/(?:src|href)=["'](\.[^"']+)["']/g),
    ...source.matchAll(/url\(["']?(\.[^"')]+)["']?\)/g)
  ];
  for (const [, reference] of references) {
    const target = resolve(dirname(resolve(root, name)), reference);
    if (!files.some((file) => resolve(root, file) === target)) {
      throw new Error(`Missing or excluded public dependency: ${name} -> ${reference}`);
    }
    await stat(target);
  }
}
await rm(output, { recursive: true, force: true });
for (const name of files) {
  await mkdir(dirname(resolve(output, name)), { recursive: true });
  await cp(resolve(root, name), resolve(output, name));
}
console.log(`Built and checked ${files.length} public files in dist. Deploy functions from the project root using Netlify Git builds or CLI.`);
