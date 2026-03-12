/**
 * Blaze Template Engine -- File-based HTML templates.
 *
 * Equivalent to EEx templates in the Elixir version.
 * Templates use ${assigns.name} interpolation inside backtick strings.
 * Files are loaded from the templates/ directory.
 */

import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const templateCache = new Map<string, string>();

const __dirname = dirname(fileURLToPath(import.meta.url));

function templateDir(): string {
  return join(__dirname, "..", "..", "templates");
}

export async function renderTemplate(
  name: string,
  assigns: Record<string, unknown> = {},
): Promise<string> {
  let source = templateCache.get(name);

  if (!source) {
    const path = join(templateDir(), `${name}.html`);

    try {
      source = await readFile(path, "utf-8");
    } catch {
      throw new Error(`Template not found: ${path}`);
    }

    templateCache.set(name, source);
  }

  // Evaluate template: replace ${...} expressions with assigns values
  const fn = new Function("assigns", `return \`${source}\`;`);
  return fn(assigns) as string;
}

export function clearTemplateCache(): void {
  templateCache.clear();
}
