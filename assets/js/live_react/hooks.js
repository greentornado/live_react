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

/**
 * Navigate using LiveView's navigation system.
 * Works with both LiveView patches and full redirects.
 */
function liveNavigate(hook, path, mode = "redirect") {
  if (!path || !hook.liveSocket) return;

  try {
    if (mode === "patch") {
      hook.pushEvent("__live_react_patch", { to: path });
    } else {
      // Use LiveView's redirect — this handles live_session navigation properly
      window.location.href = path;
    }
  } catch (_e) {
    window.location.href = path;
  }
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
    // Navigation helper — React components can call navigate("/path")
    navigate: (path, opts) => liveNavigate(hook, path, opts?.mode),
  };
}

/**
 * Intercept clicks inside React container for LiveView-compatible navigation.
 * Handles: <a href>, <button data-href>, onClick with navigate()
 */
function setupClickDelegation(hook) {
  hook.el.addEventListener("click", (e) => {
    // Find the closest <a> or <button data-href> from the click target
    const anchor = e.target.closest("a[href]");
    const navButton = e.target.closest("button[data-href]");

    const el = anchor || navButton;
    if (!el) return;

    const href = anchor ? anchor.getAttribute("href") : navButton.getAttribute("data-href");
    if (!href) return;

    // Skip external links, anchors, and special protocols
    if (href.startsWith("http") || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) {
      return;
    }

    // Skip if already handled by LiveView (has data-phx-link)
    if (el.hasAttribute("data-phx-link")) return;

    // Skip if meta/ctrl key held (user wants new tab)
    if (e.metaKey || e.ctrlKey || e.shiftKey) return;

    // Intercept and navigate via LiveView
    e.preventDefault();
    e.stopPropagation();
    liveNavigate(hook, href);
  });
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

      // Setup click delegation for LiveView navigation
      setupClickDelegation(this);

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
