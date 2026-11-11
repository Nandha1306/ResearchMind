import { QueryClient } from "@tanstack/react-query";

/**
 * The application's single React Query client.
 *
 * Exported from a module rather than created inside `App` so that non-React
 * code -- the axios interceptor and the sign-out routine -- can clear cached
 * per-user data without going through a hook.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});
