# Step 23: LiveComponents

[← Previous: Step 22 - LiveView Navigation](22-liveview-navigation.md) | [Next: Step 24 →](24-js-hooks.md)

---

## What We're Building

LiveViews are great for full-page real-time UIs, but as pages grow complex
you want to break them into **reusable, stateful components** — each with
its own state and event handling, nested inside a parent LiveView.

In this step we add **LiveComponents** (equivalent to Phoenix LiveComponent):

1. `LiveComponent` abstract base class with `mount()`, `handleEvent()`, `render()`
2. `component()` helper to embed components in LiveView templates
3. Client-side `resolveEvent()` for automatic event namespacing
4. Server-side event routing that splits `"componentId:event"` and dispatches

## Concepts You'll Learn

- Component state stored in parent assigns (`__components__` map)
- Props merging on re-render (new props merge into existing component state)
- Event namespacing via DOM walk (`bv-component` attribute)
- Separation of concerns: components manage their own state independently

## The Code

### 1. LiveComponent Base Class (`src/blaze/live_component.ts`)

```typescript
export type ComponentEntry = [
  componentClass: new () => LiveComponent,
  assigns: Record<string, unknown>,
];

export abstract class LiveComponent {
  mount?(assigns: Record<string, unknown>): void;

  abstract handleEvent(
    event: string,
    params: Record<string, unknown>,
    assigns: Record<string, unknown>,
  ): void;

  abstract render(assigns: Record<string, unknown>): string | Rendered;
}
```

Key differences from LiveView:
- No socket — components modify their `assigns` object directly
- State is stored in the parent's `__components__` map, not a separate process
- `mount()` is optional (called once on first render)

### 2. The `component()` Helper

```typescript
export function component(
  parentAssigns: Record<string, unknown>,
  ComponentClass: new () => LiveComponent,
  opts: { id: string; [key: string]: unknown },
): string {
  const { id, ...props } = opts;
  const components = (parentAssigns.__components__ ?? {}) as Record<string, ComponentEntry>;

  let compAssigns: Record<string, unknown>;
  const existing = components[id];

  if (existing && existing[0] === ComponentClass) {
    compAssigns = { ...existing[1], ...props };  // Merge new props
  } else {
    compAssigns = { ...props };                   // New: init with props
    const instance = new ComponentClass();
    if (instance.mount) instance.mount(compAssigns);
  }

  components[id] = [ComponentClass, compAssigns];
  parentAssigns.__components__ = components;

  const instance = new ComponentClass();
  const result = instance.render(compAssigns);
  const html = isRendered(result) ? buildHtml(result.statics, result.dynamics) : result;

  return `<div bv-component="${id}">${html}</div>`;
}
```

The wrapper `<div bv-component="id">` is what the client uses for event namespacing.

### 3. Client-Side Event Namespacing (`public/blaze.js`)

```javascript
function resolveEvent(eventName, el) {
  var node = el;
  while (node && node !== container) {
    var componentId = node.getAttribute("bv-component");
    if (componentId) return componentId + ":" + eventName;
    node = node.parentElement;
  }
  return eventName;
}
```

Every event handler (bv-click, bv-change, bv-submit, bv-keydown) calls
`resolveEvent()` before sending. If the element is inside a
`<div bv-component="alerts">`, then `"dismiss"` becomes `"alerts:dismiss"`.

### 4. Server-Side Event Routing (`src/blaze/live_handler.ts`)

```typescript
const colonIdx = eventName.indexOf(":");
if (colonIdx > 0) {
  const componentId = eventName.slice(0, colonIdx);
  const componentEvent = eventName.slice(colonIdx + 1);
  const components = (data.socket.assigns.__components__ ?? {}) as Record<string, ComponentEntry>;
  const entry = components[componentId];
  if (entry) {
    const [CompClass, compAssigns] = entry;
    const instance = new CompClass();
    instance.handleEvent(componentEvent, parsed.params ?? {}, compAssigns);
  }
} else {
  await data.view.handleEvent(eventName, parsed.params ?? {}, data.socket);
}
```

### 5. Example Components

**ToggleButton** — on/off toggle with independent state:

```typescript
export class ToggleButton extends LiveComponent {
  mount(assigns: Record<string, unknown>): void {
    if (assigns.on === undefined) assigns.on = false;
  }

  handleEvent(_event: string, _params: Record<string, unknown>, assigns: Record<string, unknown>): void {
    assigns.on = !assigns.on;
  }

  render(assigns: Record<string, unknown>): string {
    const on = assigns.on as boolean;
    const label = assigns.label as string;
    return `<button bv-click="toggle" style="...">${label}: ${on ? "ON" : "OFF"}</button>`;
  }
}
```

**NotificationBadge** — dismissible badge with count:

```typescript
export class NotificationBadge extends LiveComponent {
  mount(assigns: Record<string, unknown>): void {
    assigns.dismissed = false;
  }

  handleEvent(event: string, _params: Record<string, unknown>, assigns: Record<string, unknown>): void {
    if (event === "dismiss") assigns.dismissed = true;
    if (event === "restore") assigns.dismissed = false;
  }

  render(assigns: Record<string, unknown>): string {
    // Shows count badge or "dismissed" state with restore button
  }
}
```

### 6. Demo LiveView (`src/my_app/components_demo_live.ts`)

```typescript
export class ComponentsDemoLive extends LiveView {
  render(assigns: Record<string, unknown>): Rendered {
    const alerts = component(assigns, NotificationBadge, { id: "alerts", label: "Alerts", count: 3 });
    const messages = component(assigns, NotificationBadge, { id: "messages", label: "Messages", count: 7 });
    const darkMode = component(assigns, ToggleButton, { id: "dark-mode", label: "Dark Mode" });
    // ...
    return bv`<h1>LiveComponents Demo</h1>
      <div>${alerts}</div>
      <div>${messages}</div>
      <div>${darkMode}</div>`;
  }
}
```

Five independent component instances, each with their own state. The parent
also has its own click counter to show parent/component state separation.

## How It Works

```
User clicks "Dismiss" inside <div bv-component="alerts">
  ↓
resolveEvent("dismiss", button) → walks up DOM → finds bv-component="alerts"
  ↓
Sends: { type: "event", event: "alerts:dismiss", params: {} }
  ↓
Server splits on ":" → componentId="alerts", event="dismiss"
  ↓
Looks up __components__["alerts"] → [NotificationBadge, { count: 3, dismissed: false }]
  ↓
Calls NotificationBadge.handleEvent("dismiss", {}, assigns)
  ↓
assigns.dismissed = true
  ↓
Re-render parent → component() re-renders NotificationBadge with updated state
  ↓
Diff sent to client → morphdom patches only the changed badge
```

## Try It Out

```bash
npx tsx src/app.ts
# Visit http://localhost:4001/components
```

- Toggle each button independently — they don't affect each other
- Dismiss badges, then restore them
- Click "Parent Click" — parent state is separate from component state
- Navigate to other LiveViews and back — component state resets (no persistence across navigations)

## File Checklist

| File | Action | Purpose |
|------|--------|---------|
| `src/blaze/live_component.ts` | **New** | LiveComponent class + component() helper |
| `src/my_app/components/toggle_button.ts` | **New** | ToggleButton component |
| `src/my_app/components/notification_badge.ts` | **New** | NotificationBadge component |
| `src/my_app/components_demo_live.ts` | **New** | Demo LiveView with 5 components |
| `public/blaze.js` | Modified | Added resolveEvent() for event namespacing |
| `src/blaze/live_handler.ts` | Modified | Component event routing (split on ":") |
| `src/app.ts` | Modified | Added /components route |

## What's Next

In **Step 24**, we'll add **JS Hooks** — allowing LiveViews to attach
client-side JavaScript behaviors to elements, bridging server state with
browser APIs (focus, scroll, animations, third-party libraries).
