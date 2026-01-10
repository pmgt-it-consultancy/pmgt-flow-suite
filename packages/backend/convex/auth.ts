import { convexAuth } from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";
import { DataModel } from "./_generated/dataModel";

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

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [CustomPassword],
});
