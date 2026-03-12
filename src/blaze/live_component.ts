/**
 * Blaze LiveComponent -- Reusable stateful components inside LiveViews.
 *
 * Equivalent to Ignite.LiveComponent in the Elixir version.
 * Components have their own state (assigns) and event handlers,
 * stored in the parent LiveView's __components__ map.
 *
 * Events inside a component are namespaced as "componentId:event"
 * by the client (via bv-component wrapper div) and routed to
 * the component's handleEvent on the server.
 */

import type { Rendered } from "./rendered.js";
import { buildHtml, isRendered } from "./rendered.js";

/** Component state stored in parent assigns */
export type ComponentEntry = [
  componentClass: new () => LiveComponent,
  assigns: Record<string, unknown>,
];

/**
 * Abstract base class for LiveComponents.
 *
 * Subclass and implement render() and handleEvent().
 * Optionally implement mount() for initialization logic.
 */
export abstract class LiveComponent {
  /**
   * Called once when the component is first created.
   * Modify the assigns object to set initial state beyond provided props.
   */
  mount?(assigns: Record<string, unknown>): void;

  /**
   * Called when an event is received for this component.
   * Update the assigns object based on the event.
   */
  abstract handleEvent(
    event: string,
    params: Record<string, unknown>,
    assigns: Record<string, unknown>,
  ): void;

  /**
   * Return HTML or Rendered for this component.
   */
  abstract render(assigns: Record<string, unknown>): string | Rendered;
}

/**
 * Render a LiveComponent inside a parent LiveView template.
 *
 * Usage in a LiveView render():
 *   const badge = component(assigns, NotificationBadge, { id: "alerts", count: 3 });
 *   return bv`<div>${badge}</div>`;
 *
 * Returns an HTML string wrapped in a <div bv-component="id"> container.
 * The component's state is stored in parentAssigns.__components__.
 */
export function component(
  parentAssigns: Record<string, unknown>,
  ComponentClass: new () => LiveComponent,
  opts: { id: string; [key: string]: unknown },
): string {
  const { id, ...props } = opts;

  // Get or create the components map on the parent assigns
  const components = (parentAssigns.__components__ ?? {}) as Record<string, ComponentEntry>;

  let compAssigns: Record<string, unknown>;
  const existing = components[id];

  if (existing && existing[0] === ComponentClass) {
    // Existing component: merge new props into existing state
    compAssigns = { ...existing[1], ...props };
  } else {
    // New component: initialize with props, call mount if defined
    compAssigns = { ...props };
    const instance = new ComponentClass();
    if (instance.mount) {
      instance.mount(compAssigns);
    }
  }

  // Store updated state back
  components[id] = [ComponentClass, compAssigns];
  parentAssigns.__components__ = components;

  // Render the component
  const instance = new ComponentClass();
  const result = instance.render(compAssigns);
  const html = isRendered(result)
    ? buildHtml(result.statics, result.dynamics)
    : result;

  return `<div bv-component="${id}">${html}</div>`;
}
