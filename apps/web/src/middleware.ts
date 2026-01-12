import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/**
 * Middleware for Next.js
 *
 * Note: Authentication is handled client-side by Convex Auth.
 * Convex Auth stores tokens in localStorage (not accessible from middleware).
 * The AdminLayout component handles auth redirects on the client.
 *
 * This middleware can be used for:
 * - Adding security headers
 * - Logging/analytics
 * - Other server-side concerns that don't require auth state
 */
export function middleware(_request: NextRequest) {
  // Allow all requests - auth is handled client-side by Convex Auth
  return NextResponse.next();
}

export const config = {
  matcher: [
    // Match all routes except static files and API routes
    "/((?!_next/static|_next/image|favicon.ico|api).*)",
  ],
};
