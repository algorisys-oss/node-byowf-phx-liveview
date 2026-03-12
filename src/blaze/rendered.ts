/**
 * Blaze Rendered -- Tagged template engine for efficient diffing.
 *
 * Equivalent to Phoenix.LiveView.Rendered in the Elixir version.
 *
 * The `bv` tagged template function splits a template into:
 * - statics: the fixed string parts (never change between renders)
 * - dynamics: the interpolated values (change when assigns change)
 *
 * Supports nested Rendered: when a bv`` template is interpolated
 * inside another bv`` template, its statics/dynamics are flattened
 * into the parent for a single-level diff.
 *
 * Example:
 *   bv`<h1>Count: ${count}</h1>`
 *   → { statics: ["<h1>Count: ", "</h1>"], dynamics: ["42"] }
 *
 *   // Nested:
 *   const header = bv`<h1>${title}</h1>`;
 *   bv`<div>${header}<p>${body}</p></div>`
 *   → flattened statics/dynamics with header's dynamics merged in
 */

/**
 * A rendered template with split statics and dynamics.
 */
export interface Rendered {
  statics: string[];
  dynamics: string[];
}

/**
 * Tagged template literal that splits a template into statics and dynamics.
 *
 * When a value is itself a Rendered object, it is flattened into the
 * parent template -- its statics merge with the parent's statics, and
 * its dynamics are appended to the parent's dynamics list.
 */
export function bv(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Rendered {
  // Fast path: no nesting, skip flattening
  const hasNested = values.some(isRendered);

  if (!hasNested) {
    return {
      statics: Array.from(strings),
      dynamics: values.map(String),
    };
  }

  // Flatten nested Rendered objects into parent
  const statics: string[] = [];
  const dynamics: string[] = [];

  // We build by walking through strings[0], values[0], strings[1], values[1], ..., strings[N]
  // Each value is either a scalar (becomes a dynamic) or a Rendered (gets flattened).
  // We track a "pending" static string that accumulates until we encounter a dynamic.
  let pending = strings[0]!;

  for (let i = 0; i < values.length; i++) {
    const value = values[i];

    if (isRendered(value)) {
      const cs = value.statics;
      const cd = value.dynamics;

      if (cd.length === 0) {
        // No dynamics in child -- it's pure static, just append
        pending += (cs[0] ?? "") + (strings[i + 1] ?? "");
      } else {
        // Merge pending + first child static
        statics.push(pending + (cs[0] ?? ""));
        pending = "";

        // Add child dynamics and interleaved child statics
        for (let j = 0; j < cd.length; j++) {
          dynamics.push(cd[j]!);
          if (j < cd.length - 1) {
            statics.push(cs[j + 1] ?? "");
          }
        }

        // Last child static merges with next parent string
        pending = (cs[cd.length] ?? "") + (strings[i + 1] ?? "");
      }
    } else {
      // Scalar value -- emit pending as static, value as dynamic
      statics.push(pending);
      dynamics.push(String(value));
      pending = strings[i + 1] ?? "";
    }
  }

  // Final trailing static
  statics.push(pending);

  return { statics, dynamics };
}

/**
 * Type guard: is this value a Rendered object?
 */
export function isRendered(value: unknown): value is Rendered {
  return (
    typeof value === "object" &&
    value !== null &&
    "statics" in value &&
    "dynamics" in value &&
    Array.isArray((value as Rendered).statics) &&
    Array.isArray((value as Rendered).dynamics)
  );
}

/**
 * Reconstruct the full HTML from statics and dynamics.
 *
 * Zips statics and dynamics together:
 *   statics: ["<h1>", "</h1>"], dynamics: ["Hello"]
 *   → "<h1>Hello</h1>"
 */
export function buildHtml(statics: string[], dynamics: string[]): string {
  let html = statics[0] ?? "";
  for (let i = 0; i < dynamics.length; i++) {
    html += dynamics[i] + (statics[i + 1] ?? "");
  }
  return html;
}

/**
 * Compute a sparse diff between old and new dynamics.
 *
 * Returns an object mapping changed indices to their new values,
 * or null if nothing changed.
 *
 * Example:
 *   old: ["0", "Alice"]
 *   new: ["1", "Alice"]
 *   → { "0": "1" } (only index 0 changed)
 *
 *   old: ["0", "Alice"]
 *   new: ["0", "Alice"]
 *   → null (no changes)
 */
export function diffDynamics(
  oldDynamics: string[],
  newDynamics: string[],
): Record<string, string> | null {
  if (oldDynamics.length !== newDynamics.length) {
    // Structure changed -- return all dynamics as full update
    const result: Record<string, string> = {};
    for (let i = 0; i < newDynamics.length; i++) {
      result[String(i)] = newDynamics[i]!;
    }
    return result;
  }

  const diff: Record<string, string> = {};
  let hasChanges = false;

  for (let i = 0; i < newDynamics.length; i++) {
    if (oldDynamics[i] !== newDynamics[i]) {
      diff[String(i)] = newDynamics[i]!;
      hasChanges = true;
    }
  }

  return hasChanges ? diff : null;
}
