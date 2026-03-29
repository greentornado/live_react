import React from "react";
import ReactDOM from "react-dom/client";
import { getComponentTree } from "./utils";

function getAttributeJson(el, attributeName) {
  const data = el.getAttribute(attributeName);
  return data ? JSON.parse(data) : {};
}

// NOTE: dangerouslySetInnerHTML usage here is safe — content comes from
// server-rendered LiveView slots (trusted Elixir templates), not user input.
function getChildren(hook) {
  const dataSlots = getAttributeJson(hook.el, "data-slots");

  if (!dataSlots?.default) {
    return [];
  }

  return [
    React.createElement("div", {
      dangerouslySetInnerHTML: { __html: atob(dataSlots.default).trim() },
    }),
  ];
}

function getProps(hook) {
  return {
    ...getAttributeJson(hook.el, "data-props"),
    pushEvent: hook.pushEvent.bind(hook),
    pushEventTo: hook.pushEventTo.bind(hook),
    handleEvent: hook.handleEvent.bind(hook),
    removeHandleEvent: hook.removeHandleEvent.bind(hook),
    upload: hook.upload.bind(hook),
    uploadTo: hook.uploadTo.bind(hook),
  };
}

export function getHooks(components) {
  const ReactHook = {
    _render() {
      try {
        // Skip render if data props haven't changed (memoization)
        const currentPropsJson = this.el.getAttribute("data-props");
        const currentSlotsJson = this.el.getAttribute("data-slots");
        if (
          this._lastPropsJson &&
          currentPropsJson === this._lastPropsJson &&
          currentSlotsJson === this._lastSlotsJson
        ) {
          return;
        }
        this._lastPropsJson = currentPropsJson;
        this._lastSlotsJson = currentSlotsJson;

        const tree = getComponentTree(
          this._Component,
          getProps(this),
          getChildren(this),
        );
        this._root.render(tree);
      } catch (error) {
        const name = this.el.getAttribute("data-name") || "Unknown";
        console.error(`[LiveReact] Error rendering ${name}:`, error);
      }
    },
    mounted() {
      const componentName = this.el.getAttribute("data-name");
      if (!componentName) {
        throw new Error("Component name must be provided");
      }

      this._Component = components[componentName];

      if (!this._Component) {
        console.error(`[LiveReact] Component "${componentName}" not found in registry`);
        return;
      }

      // Hide loading skeleton on first component mount
      const skeleton = document.getElementById("app-skeleton");
      if (skeleton) skeleton.style.display = "none";

      const isSSR = this.el.hasAttribute("data-ssr");

      if (isSSR) {
        try {
          const tree = getComponentTree(
            this._Component,
            getProps(this),
            getChildren(this),
          );
          this._root = ReactDOM.hydrateRoot(this.el, tree);
        } catch (error) {
          console.warn(`[LiveReact] Hydration failed for ${componentName}, falling back:`, error);
          this._root = ReactDOM.createRoot(this.el);
          this._render();
        }
      } else {
        this._root = ReactDOM.createRoot(this.el);
        this._render();
      }

      this._lastPropsJson = this.el.getAttribute("data-props");
      this._lastSlotsJson = this.el.getAttribute("data-slots");
    },
    updated() {
      if (this._root) {
        this._render();
      }
    },
    destroyed() {
      if (this._root) {
        window.addEventListener(
          "phx:page-loading-stop",
          () => {
            try { this._root.unmount(); } catch (_e) { /* ignore */ }
          },
          { once: true },
        );
      }
    },
  };

  return { ReactHook };
}
