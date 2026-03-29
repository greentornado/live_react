import React, { createContext, useContext, useCallback } from "react";

export const LiveReactContext = createContext(null);

export function LiveReactProvider({ children, ...props }) {
  return (
    <LiveReactContext.Provider value={props}>
      {children}
    </LiveReactContext.Provider>
  );
}

/**
 * Hook to access LiveView bridge functions from React components.
 * Returns: { pushEvent, handleEvent, navigate, ... }
 */
export function useLiveReact() {
  return useContext(LiveReactContext);
}

/**
 * Hook for LiveView-compatible navigation from React.
 * Usage: const navigate = useNavigate();
 *        navigate("/jobs");
 *        <Button onClick={() => navigate("/login")}>Login</Button>
 */
export function useNavigate() {
  const ctx = useContext(LiveReactContext);
  return useCallback(
    (path, opts) => {
      if (ctx?.navigate) {
        ctx.navigate(path, opts);
      } else {
        window.location.href = path;
      }
    },
    [ctx],
  );
}
