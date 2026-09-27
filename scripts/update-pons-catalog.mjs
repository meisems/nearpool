import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const output = join(root, "public", "pons-launches.json");
const temp = `${output}.tmp`;
const source = "https://www.ponsfamily.com/api/pons-launches?catalog=1&v=12";

try {
  const response = await fetch(source, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Pons catalog returned ${response.status}`);
  const payload = await response.text();
  JSON.parse(payload);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(temp, payload);
  await rename(temp, output);
  console.log(`Updated ${output}`);
} catch (error) {
  console.warn(`Could not refresh Pons catalog; using the checked-in snapshot. ${error.message}`);
}
