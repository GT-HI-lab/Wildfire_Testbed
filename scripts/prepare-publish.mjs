import { cp, mkdir, rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist");
for (const dir of ["client", "server", "shared"]) {
  await cp(dir, `dist/${dir}`, { recursive: true });
}
