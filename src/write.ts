import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/** Write a file by renaming a temp file in the same directory. */
export async function writeFileAtomic(file: string, content: string): Promise<void> {
  const directory = path.dirname(file);
  await mkdir(directory, { recursive: true });
  const temp = path.join(directory, `.${path.basename(file)}.${process.pid}.tmp`);
  await writeFile(temp, content, "utf8");
  await rename(temp, file);
}
