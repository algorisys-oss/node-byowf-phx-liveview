# Step 18: Fine-Grained Diffing

[← Previous: Step 17 - Diffing Engine](17-diffing-engine.md) | [Next: Step 19 - Morphdom Integration →](19-morphdom-integration.md)

---

## What We're Building

In Step 17, we added the diffing engine -- statics/dynamics split with
sparse updates. But we only had one dynamic value (the count). Real
views have many: labels, colors, messages, form values.

In this step, we add:

1. **Nested `bv` templates** -- composable view fragments that flatten
   into a single statics/dynamics structure
2. **A dashboard demo** with 10 dynamic values and 3 stat card components
3. **True sparse diffs** -- when you click "+", only 2 of 10 dynamics
   are sent (count and clicks), not the other 8

### How This Compares to Ignite (Elixir)

In Ignite, the `~L` sigil compiles templates at compile-time using a
custom EEx engine. Each `<%= expr %>` becomes a numbered dynamic. The
handler compares old and new dynamics arrays and sends only changed
indices.

In Blaze, the `bv` tagged template literal achieves the same split at
runtime. Nested `bv` templates are flattened -- a child's dynamics merge
into the parent's, so the diff works across the entire view.

## Concepts You'll Learn

### Nested Templates

View fragments can be composed using nested `bv` templates:

```typescript
function statCard(label: string, value: unknown, color: string): Rendered {
  return bv`
    <div style="background:${color}">
      <div>${label}</div>
      <div>${value}</div>
    </div>`;
}

render(assigns) {
  const countCard = statCard("Counter", assigns.count, "#e45");
  return bv`<div>${countCard}</div>`;
}
```

When a `Rendered` object is interpolated into a `bv` template, its
statics and dynamics are **flattened** into the parent:

```
statCard returns: { statics: ["<div style=\"background:", "\">..."], dynamics: ["#e45", "Counter", "0"] }
Parent bv`` absorbs those dynamics into its own list.
```

The result is a single flat statics/dynamics pair, no matter how deep
the nesting.

### How Flattening Works

```
Parent: bv`<div>${child}<p>${body}</p></div>`
Child:  { statics: ["<h1>", "</h1>"], dynamics: ["Title"] }

Step 1: "<div>" + child.statics[0] = "<div><h1>"  → parent static
Step 2: child.dynamics[0] = "Title"                 → parent dynamic
Step 3: child.statics[1] + "<p>" = "</h1><p>"       → parent static
Step 4: body                                         → parent dynamic
Step 5: "</p></div>"                                 → parent static

Result: { statics: ["<div><h1>", "</h1><p>", "</p></div>"],
          dynamics: ["Title", "body"] }
```

### The Pending Accumulator Pattern

The flattening algorithm uses a `pending` string that accumulates
static text until a dynamic is encountered:

1. Start with `pending = strings[0]`
2. For each value:
   - **Scalar:** Push `pending` as a static, value as a dynamic, reset pending
   - **Rendered child (has dynamics):** Push `pending + child.statics[0]` as a static,
     add child's dynamics and interleaved statics, reset pending to last child static
   - **Rendered child (no dynamics):** Just append child's static content to pending
3. Push final `pending` as trailing static

### Sparse Diff Example

The dashboard has 10 dynamics: 3 colors, 3 labels, 3 values, 1 input.
When you click "+":

```
Old: ["#e45", "Counter", "0", "#36c", "Total Clicks", "0", "#2a9", "Message", "Welcome!", "Welcome!"]
New: ["#e45", "Counter", "1", "#36c", "Total Clicks", "1", "#2a9", "Message", "Welcome!", "Welcome!"]
                          ↑                              ↑
Diff: { "2": "1", "5": "1" }    ← only 2 indices changed
```

That's **80% of dynamics skipped** -- only count and clicks are sent.

### Length Mismatch Safety

If the dynamics array length changes between renders (e.g., a
conditional adds/removes a nested template), `diffDynamics()` now
returns all dynamics as a full update instead of producing a corrupted
sparse diff.

### Comparison: Elixir vs Node.js

| Concept | Elixir (Ignite) | Node.js (Blaze) |
|---|---|---|
| Template split | `~L` sigil + EEx engine | `bv` tagged template |
| Nesting | Render to string, embed | Flatten statics/dynamics |
| Sparse diff | Per-index comparison | Same: `diffDynamics()` |
| Component render | Process dictionary side-channel | Direct function call |
| Compile vs runtime | Compile-time split | Runtime split |

## The Code

### `src/blaze/rendered.ts` -- Full File with Nested Flattening

This is the complete `rendered.ts` after Step 18. The key changes from
Step 17 are: (1) `bv()` now detects nested `Rendered` values and
flattens them, and (2) `diffDynamics()` has a length mismatch guard.

```typescript
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
```

**Key decisions:**

- **Fast path:** When no values are `Rendered`, skip flattening entirely
  (just `Array.from(strings)` + `values.map(String)`)
- **Pending accumulator:** Static text is accumulated in `pending` and
  only pushed when a dynamic is encountered. This correctly merges
  boundaries between parent and child statics.
- **Deep nesting:** Works automatically -- a child that was itself
  flattened is just a regular `Rendered` to its parent.
- **Length mismatch guard:** If the dynamics array length changes between
  renders, all dynamics are returned as a full update to prevent
  corrupted sparse diffs.

### `src/my_app/dashboard_live.ts` -- Multi-Dynamic Dashboard

This is the complete dashboard LiveView. It uses three nested `bv`
templates (stat cards) that flatten into a single statics/dynamics
structure with 10 dynamic values.

```typescript
/**
 * DashboardLive -- A dashboard with multiple dynamic values.
 *
 * Demonstrates fine-grained diffing with nested bv`` templates:
 * - statCard() returns a Rendered object (3 dynamics each)
 * - Parent template flattens all child dynamics into one flat list
 * - On increment, only 2 of 10 dynamics are sent over the wire
 */

import { LiveView, type LiveViewSocket } from "../blaze/live_view.js";
import { bv, type Rendered } from "../blaze/rendered.js";

function statCard(label: string, value: unknown, color: string): Rendered {
  return bv`
    <div style="display:inline-block; background:${color}; color:white;
                padding:1rem 1.5rem; border-radius:8px; margin:0.5rem; min-width:120px; text-align:center;">
      <div style="font-size:0.8rem; opacity:0.8;">${label}</div>
      <div style="font-size:2rem; font-weight:bold;">${value}</div>
    </div>`;
}

export class DashboardLive extends LiveView {
  mount(socket: LiveViewSocket): void {
    socket.assign({
      count: 0,
      clicks: 0,
      message: "Welcome!",
    });
  }

  handleEvent(
    event: string,
    params: Record<string, unknown>,
    socket: LiveViewSocket,
  ): void {
    const { count, clicks } = socket.assigns as { count: number; clicks: number };

    switch (event) {
      case "increment":
        socket.assign({ count: count + 1, clicks: clicks + 1 });
        break;
      case "decrement":
        socket.assign({ count: count - 1, clicks: clicks + 1 });
        break;
      case "reset":
        socket.assign({ count: 0, clicks: clicks + 1, message: "Reset!" });
        break;
      case "update_message":
        socket.assign({ message: params.message || "" });
        break;
    }
  }

  render(assigns: Record<string, unknown>): Rendered {
    const countCard = statCard("Counter", assigns.count, "#e45");
    const clickCard = statCard("Total Clicks", assigns.clicks, "#36c");
    const msgCard = statCard("Message", assigns.message, "#2a9");

    return bv`
      <h1>Dashboard</h1>
      <div style="margin: 1rem 0;">
        ${countCard}
        ${clickCard}
        ${msgCard}
      </div>
      <div style="margin: 1rem 0;">
        <button bv-click="decrement">−</button>
        <button bv-click="reset">Reset</button>
        <button bv-click="increment">+</button>
      </div>
      <div style="margin: 1rem 0;">
        <label>Message: </label>
        <input bv-change="update_message" name="message" value="${assigns.message}"
               style="padding:0.4rem; font-size:1rem; border:1px solid #ccc; border-radius:4px;">
      </div>
      <p style="color: #888; font-size: 0.85rem;">
        Each stat card is a nested bv\`\` template. Only changed values are sent as sparse diffs.
      </p>
      <div style="margin-top: 1rem;">
        <a href="/counter" bv-navigate="/counter">Counter</a> |
        <a href="/shared-counter" bv-navigate="/shared-counter">Shared Counter</a> |
        <a href="/components" bv-navigate="/components">Components</a> |
        <a href="/hooks" bv-navigate="/hooks">Hooks</a> |
        <a href="/streams" bv-navigate="/streams">Streams</a>
      </div>
    `;
  }
}
```

**Important details:**

- `handleEvent()` reads `count` and `clicks` from `socket.assigns`, not
  from bare variables. The previous buggy version referenced undefined
  `count`/`clicks` variables.
- All four events are handled: `increment`, `decrement`, `reset`, and
  `update_message`.
- The `statCard()` function returns a `Rendered` with 3 dynamics each
  (color, label, value), for a total of 9 dynamics from cards plus 1
  from the input value = 10 dynamics.

### `src/app.ts` -- Route Registration

Add the dashboard import and route:

```typescript
import { DashboardLive } from "./my_app/dashboard_live.js";

// In the liveRoutes map:
export const liveRoutes = new Map<string, LiveViewClass>([
  ["/counter", CounterLive],
  ["/dashboard", DashboardLive],
  // ... other routes
]);
```

Also add a link on the landing page:

```html
<li><a href="/dashboard">/dashboard</a> — multi-dynamic dashboard (nested bv templates)</li>
```

## How It Works

```
1. Mount:
   → render() calls statCard() 3 times, each returns a Rendered
   → bv`` flattens all into one: 11 statics, 10 dynamics
   → Send { type: "mount", statics: [...11], dynamics: [...10] }

2. Click "+" (increment):
   → handleEvent: count 0→1, clicks 0→1
   → render(): same statics, dynamics[2] and dynamics[5] changed
   → diffDynamics: { "2": "1", "5": "1" }
   → Send { type: "diff", dynamics: {"2":"1","5":"1"} }   ← only 2 of 10!

3. Type "Hello" in message input:
   → handleEvent: message "Welcome!"→"Hello"
   → render(): dynamics[8] and dynamics[9] changed (card + input)
   → diffDynamics: { "8": "Hello", "9": "Hello" }
   → Send { type: "diff", dynamics: {"8":"Hello","9":"Hello"} }
```

## Try It Out

### 1. Start the server

```bash
npx tsx src/app.ts
```

### 2. Visit the dashboard

Open http://localhost:4001/dashboard -- you'll see three colorful stat
cards, buttons, and a message input.

### 3. Watch sparse diffs in DevTools

Open DevTools → Network → WS. Click on the WebSocket connection and
look at the Messages tab. Click "+" and watch:

```json
← { "type": "mount", "statics": [...], "dynamics": ["#e45","Counter","0","#36c","Total Clicks","0","#2a9","Message","Welcome!","Welcome!"] }
→ { "type": "event", "event": "increment" }
← { "type": "diff", "dynamics": {"2":"1","5":"1"} }
```

Only 2 of 10 dynamics sent -- the counter value and click count.

### 4. Type in the message input

Change the message and watch only the message indices update:

```json
← { "type": "diff", "dynamics": {"8":"Hi","9":"Hi"} }
```

### 5. Compare with counter

The counter at http://localhost:4001/counter still works identically --
it has just 1 dynamic, so diffs are always `{"0": "value"}`.

### 6. Type check

```bash
npx tsc --noEmit
```

## File Checklist

After this step, your project should have these files:

| File | Status | Purpose |
|------|--------|---------|
| `src/blaze/rendered.ts` | **Modified** | Nested `Rendered` flattening in `bv()`, length mismatch guard in `diffDynamics()` |
| `src/my_app/dashboard_live.ts` | **New** | Dashboard with stat cards, multi-dynamic sparse diffs |
| `src/app.ts` | **Modified** | Register `/dashboard` route, landing page link |

---

[← Previous: Step 17 - Diffing Engine](17-diffing-engine.md) | [Next: Step 19 - Morphdom Integration →](19-morphdom-integration.md)

## What's Next

The DOM is currently updated with `innerHTML`, which destroys and
recreates all elements on every update. This loses input focus, scroll
position, and CSS animations. In **Step 19**, we'll integrate
**morphdom** for focus-preserving DOM patches that update only the
elements that actually changed.
