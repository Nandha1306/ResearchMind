import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { signOutClientSession } from "../lib/session";

/**
 * The sign-out action for UI components.
 *
 * Wraps `signOutClientSession()` with router navigation and an in-flight flag
 * so a double click cannot fire two revocation requests. `ProtectedRoute`
 * already redirects once `isAuthenticated` flips, but navigating explicitly
 * with `replace` also drops the authenticated route from the history stack, so
 * Back cannot return to it.
 */
export const useSignOut = () => {
  const navigate = useNavigate();
  const [isSigningOut, setIsSigningOut] = useState(false);
  // A ref as well as state: two clicks can land in the same React batch, before
  // `isSigningOut` has re-rendered.
  const inFlightRef = useRef(false);

  const signOut = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setIsSigningOut(true);

    try {
      // Never throws -- a failed server revocation still clears local state.
      await signOutClientSession();
    } finally {
      navigate("/login", { replace: true });
      inFlightRef.current = false;
      setIsSigningOut(false);
    }
  }, [navigate]);

  return { signOut, isSigningOut };
};
