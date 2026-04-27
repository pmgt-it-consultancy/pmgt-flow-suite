import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import type { DataModel } from "./_generated/dataModel";

// Custom Password provider that uses username instead of email
const CustomPassword = Password<DataModel>({
  profile(params) {
    return {
      name: params.name as string,
      // Username is used as email in our system
      email: params.email as string,
    };
  },
});

// 60-day session lifetime, refreshed on every authenticated request via
// Convex Auth's automatic refresh-token rotation. As long as the tablet
// makes any authenticated call within any 60-day window, the cashier
// stays signed in indefinitely under normal POS operation.
const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000;

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [CustomPassword],
  session: {
    totalDurationMs: SIXTY_DAYS_MS,
    inactiveDurationMs: SIXTY_DAYS_MS,
  },
});
