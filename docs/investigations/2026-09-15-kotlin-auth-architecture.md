# Authentication architecture for the native Kotlin POS client

**Issue:** [#16 — How does authentication work from the Kotlin client?](https://github.com/pmgt-it-consultancy/pmgt-flow-suite/issues/16)
(part of [#13 — Migrate the Android POS from React Native to native Kotlin](https://github.com/pmgt-it-consultancy/pmgt-flow-suite/issues/13))
**Date:** 2026-09-15
**Status:** research complete — recommendation below is a proposal, not a decision

---

## Answer in one line

**`@convex-dev/auth` survives the migration.** The Convex Android client's `AuthProvider<T>`
contract is a raw-`String` JWT pipe with no OIDC coupling whatsoever, and Convex Auth mints
exactly such a JWT and exposes sign-in/refresh as plain unauthenticated HTTPS actions. `apps/web`
absorbs **nothing**. The real work in this ticket is not auth — it is the **offline session cache
and PIN verification, which do not exist today** and must be built for the first time in Kotlin.

Three things in here will surprise you, so they are flagged up front:

1. **`cachedSession.ts` is dead code** with zero production call sites — offline auth does not work
   on the tablets today. (§2a)
2. **`EncryptedSharedPreferences` is deprecated** as of `security-crypto` 1.1.0, with no successor;
   the answer is Proto DataStore + a Keystore AES-GCM serializer. (§5a)
3. **The riskiest thing here is not the Android client, it's Convex Auth's own churn** — a
   `2.0.0-alpha` is already on npm that changes the token format, the refresh format, the function
   names and cuts token lifetime from 1 hour to 60 seconds. (§7)

---

## 1. Method and scope

### Sources

Two classes of source, both primary:

- **This codebase**, read from `main` @ `ba59163` ("Merge staging into main for v3.28.1").
- **Upstream source code**, read from `raw.githubusercontent.com` and from published artifact
  bytecode (`javap` on the shipped `.aar`), plus live HTTP probes of our own Convex deployment's
  public `.well-known` endpoints and unauthenticated error paths. No secondary write-ups.

### Reproducibility caveat — read this before you re-run anything

The agent worktree this was researched in sat at **v3.10.2** (`c8b44f9`), which predates the
sync layer entirely. `apps/native/src/auth/`, `apps/native/src/sync/`, `convex/sync.ts` and the
`syncDevices` table **do not exist at that commit**. Everything below was read out of the object
store with `git show main:<path>`. If you check out this branch and `cat` the paths in the ticket,
you will get "No such file or directory" and conclude the ticket is nonsense. It is not; the
worktree is just stale.

### Versions in play

| Thing                                   | Version                        | Source                                                                                                        |
| --------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `@convex-dev/auth` (all three packages) | `^0.0.90`                      | `apps/web/package.json:13`, `apps/native/package.json:32`, `packages/backend/package.json:17`                 |
| `convex` (catalog)                      | `^1.29.3`                      | `pnpm-workspace.yaml:7`                                                                                       |
| `convex` (native, pinned separately)    | `^1.31.7`                      | `apps/native/package.json:58`                                                                                 |
| `expo-secure-store`                     | `~15.0.8`                      | `apps/native/package.json:72`                                                                                 |
| `@convex-dev/auth` latest stable on npm | **0.0.95** (2026-08-11)        | npm registry                                                                                                  |
| `@convex-dev/auth` alpha dist-tag       | **2.0.0-alpha.1** (2026-08-24) | npm registry                                                                                                  |
| `dev.convex:android-convexmobile`       | **0.8.0** (2026-02-19)         | [repo1 maven-metadata.xml](https://repo1.maven.org/maven2/dev/convex/android-convexmobile/maven-metadata.xml) |

We are five patch versions behind on Convex Auth. See §7 for why that matters more than it looks.

---

## 2. Two corrections to the ticket's premises

The ticket is right about the question and wrong about two facts. Both change the answer.

### 2a. `cachedSession.ts` is dead code. Offline auth does not work today.

The ticket says the file "persists a session snapshot … so the tablet renders screens, checks
permissions and prints receipts while offline," and calls this essential. The file's own doc
comment says the same thing. **Neither is true of the running app.**

`apps/native/src/auth/cachedSession.ts` exports `readCachedSession`, `writeCachedSession`,
`clearCachedSession` and `isSessionValid`. Production call sites for those four functions:

```
$ git grep -n -E "readCachedSession|writeCachedSession|isSessionValid|clearCachedSession" main -- apps/native \
    | grep -v "auth/cachedSession.ts\|__tests__"
(no output)
```

It is imported by exactly one file, `apps/native/src/auth/__tests__/cachedSession.test.ts`, which
mocks `expo-secure-store` and round-trips the struct. It was added in `e83f746`
("feat(native): WatermelonDB schema, sync layer, status pill (Phase 2)") alongside `deviceId.ts`
and never wired in. `deviceId.ts` from that same commit _is_ wired in, in six places — so this
was an oversight, not a deliberate deferral.

What actually gates the app today, in `apps/native/src/features/auth/context/AuthContext.tsx`:

```tsx
const { isLoading: isAuthLoading, isAuthenticated: isConvexAuthenticated } = useConvexAuth();
const currentUser = useQuery(api.sessions.getCurrentUser, isConvexAuthenticated ? {} : "skip");
...
isAuthenticated: isConvexAuthenticated && !!currentUser,
```

`isConvexAuthenticated` requires a live WebSocket that has accepted the token. `currentUser` is a
live `useQuery` — Convex's JS client caches query results **in memory only**, never to disk. So on
a cold start with no network, `isConvexAuthenticated` is false, `currentUser` is `undefined`,
`isAuthenticated` is false, and `Navigation.tsx` parks the user on `LoginScreen`. Permissions come
from the same object (`currentUser.role.permissions`), so `hasPermission()` returns `false` for
everything.

The same applies to the lock screen. `convex/screenLockActions.ts` is a `"use node"` action doing
`bcrypt.compare(args.pin, userPin)` **server-side**. A cashier cannot unlock an idle-locked tablet
without network, and a manager cannot PIN-override a void or discount without network.

**Implication for the ticket:** "port `cachedSession.ts` to Kotlin" is not a port. It is building
offline auth for the first time. That is a feature with real design questions (§5), not a
translation exercise, and it should be estimated as one.

### 2b. We already ship a raw JWT to Convex over plain HTTP. The hard part is solved and in production.

The ticket frames Convex Auth and the Android client as possibly incompatible. Our own sync layer
already does precisely the thing the Android client needs, and has since v3.25.

`apps/native/src/sync/SyncBootstrap.tsx`:

```tsx
import { useAuthToken } from "@convex-dev/auth/react";
...
const token = useAuthToken();
const tokenRef = useRef<string | null>(token);
tokenRef.current = token;
useEffect(() => { setAuthTokenFn(async () => tokenRef.current); }, []);
```

`apps/native/src/sync/syncEndpoints.ts`:

```ts
async function authHeader(): Promise<Record<string, string>> {
  const token = await getSyncAuthToken();
  if (!token)
    throw new Error("syncEndpoints: no auth token (cashier not signed in)");
  return { Authorization: `Bearer ${token}` };
}
```

`packages/backend/convex/sync.ts`, at the top of `registerDevice`, `syncPull` and `syncPush`:

```ts
const userId = await getAuthUserId(ctx);
if (!userId) return unauthorized();
```

So: `@convex-dev/auth` hands us a bare token string; we put it in an `Authorization: Bearer`
header on a hand-rolled `fetch`; Convex's own auth layer resolves it back to a `userId`. No JS
SDK involved in the verification path. **A Kotlin client doing the same thing is not novel — it is
the existing production design with `fetch` swapped for OkHttp.**

---

## 3. Q1 — Can `@convex-dev/auth` mint tokens the Android `AuthProvider` can carry?

**Yes. Unambiguously, on both sides.** The two contracts meet at "a `String`."

### 3a. The Android side: `AuthProvider<T>` has no OIDC coupling

There is no `AuthProvider.kt`. The interface lives at the bottom of `ConvexClient.kt`
([raw source](https://raw.githubusercontent.com/get-convex/convex-mobile/main/android/convexmobile/src/main/java/dev/convex/android/ConvexClient.kt),
`main` @ `720a79a`):

```kotlin
interface AuthProvider<T> {
    suspend fun login(context: Context, onIdToken: (String?) -> Unit): Result<T>

    suspend fun loginFromCache(onIdToken: (String?) -> Unit): Result<T> {
        throw NotImplementedError("$this does not support loginFromCache")
    }

    suspend fun logout(context: Context): Result<Void?>

    fun extractIdToken(authResult: T): String
}
```

`T` is **unbounded**. No OIDC interface, no `Credentials` supertype, no bound of any kind. The only
thing the client ever does with a `T` is call `extractIdToken(it)` to get a `String`. From
`ConvexClientWithAuth` in the same file:

```kotlin
val token = authProvider.extractIdToken(authData)
val bridge = AuthTokenProviderBridge(
    initialToken = token,
    getValidToken = {
        authProvider.loginFromCache(idTokenHandler).getOrNull()?.let { authProvider.extractIdToken(it) }
    }
)
authBridge = bridge
ffiClient.setAuthCallback(bridge)
```

That `String` goes straight into the Rust FFI. `rust/src/convex-mobile.udl`:

```
interface MobileConvexClient {
    [Async, Throws=ClientError]
    void set_auth(string? token);
    [Async, Throws=ClientError]
    void set_auth_callback(AuthTokenProvider? provider);
};
```

and in `convex-rs` itself, `AuthenticationToken::User(String)` — a bare string on the wire.

Three independent confirmations that nothing inspects the token client-side:

1. **Clerk's own official provider is `AuthProvider<String>` with an identity `extractIdToken`**
   ([`ClerkConvexAuthProvider.kt:29,74`](https://github.com/clerk/clerk-convex-kotlin/blob/main/source/clerk-convex-kotlin/src/main/kotlin/com/clerk/convex/ClerkConvexAuthProvider.kt)):
   `override fun extractIdToken(authResult: String): String = authResult`.
2. **The repo's own instrumentation test** (`ConvexClientWithAuthTest.kt`) uses a fake provider
   whose token is the literal string `"fake id token"` and asserts it reaches the FFI unchanged.
   That is not a JWT and the client is fine with it.
3. `loginFromCache` is the reconnect-refresh hook; `javap` on the published
   `android-convexmobile-0.8.0.aar` shows it has a `$DefaultImpls`, so only `login`, `logout` and
   `extractIdToken` are actually mandatory. (You still want to implement it — see §6.)

There is also a direct escape hatch: `MobileConvexClientInterface.setAuth(String, Continuation)`
is public in the 0.8.0 bytecode, and `ConvexClient`'s `ffiClientFactory` constructor parameter is
public, so you can capture the FFI client and call `setAuth`/`setAuthCallback` without touching
`AuthProvider` at all. We should not need it, but it exists.

The docs page itself is thin and defers to the source: _"It should also be possible to integrate
other similar OpenID Connect authentication providers. See the `AuthProvider` interface in the
`convex-mobile` repo for more info."_ ([docs.convex.dev/client/android](https://docs.convex.dev/client/android)).
The Clerk/OIDC framing in the ticket comes from that page listing only Auth0 and Clerk as shipped
integrations — it is a statement about what Convex has packaged, **not** a constraint in the code.

### 3b. The Convex Auth side: a standard RS256 JWT, plus HTTP sign-in and refresh

`src/server/implementation/tokens.ts` (v0.0.95), in full-enough:

```ts
const DEFAULT_JWT_DURATION_MS = 1000 * 60 * 60; // 1 hour

return await new SignJWT({
  ...extraClaims,
  sub: args.userId + TOKEN_SUB_CLAIM_DIVIDER + args.sessionId,
})
  .setProtectedHeader({ alg: "RS256" })
  .setIssuedAt()
  .setIssuer(requireEnv("CONVEX_SITE_URL"))
  .setAudience("convex")
  .setExpirationTime(expirationTime)
  .sign(privateKey);
```

| Claim | Value                                                |
| ----- | ---------------------------------------------------- |
| `alg` | `RS256` (no `kid` in 0.0.x)                          |
| `sub` | `` `${userId}\|${sessionId}` `` — both, divider `\|` |
| `iss` | `CONVEX_SITE_URL`                                    |
| `aud` | `"convex"`                                           |
| `exp` | **now + 1 hour** (`config.jwt.durationMs` overrides) |

Which lines up exactly with our `packages/backend/convex/auth.config.ts`:

```ts
export default {
  providers: [{ domain: process.env.CONVEX_SITE_URL, applicationID: "convex" }],
};
```

`domain` = `iss`, `applicationID` = `aud`. Convex validates this through its ordinary OIDC provider
path against a published JWKS. Our deployment serves both discovery routes today (verified live,
`GET`, 200): `/.well-known/openid-configuration` and `/.well-known/jwks.json`. Note the discovery
doc is minimal — `issuer`, `jwks_uri`, `authorization_endpoint` only, no `token_endpoint` — so
point a strict OIDC client library at it and it will choke. It exists for JWKS discovery, not for
running an OAuth flow.

**Sign-in is a plain public action**, `actionGeneric` in `src/server/implementation/index.ts`,
returning `{ tokens?: { token: string; refreshToken: string } | null }`:

```
POST https://<deployment>.convex.cloud/api/action
Content-Type: application/json

{"path":"auth:signIn",
 "args":{"provider":"password","params":{"email":"…","password":"…","flow":"signIn"}},
 "format":"json"}
```

Verified empirically and unauthenticated against our own deployment: posting
`{"path":"auth:signIn","args":{}}` with no `Authorization` header reaches the handler and returns
its validation error (`Cannot sign in: Missing \`provider\`, \`params.code\` or \`refreshToken\``),
and `{"provider":"**nope**"}`returns *"Provider`**nope**`is not configured, available providers
are`password`."* — which also confirms our only configured provider is the `CustomPassword`in`convex/auth.ts`.

**Refresh is the same function with a different arg** (`signIn.ts`, first branch):

```
POST /api/action
{"path":"auth:signIn","args":{"refreshToken":"<id>|<sessionId>"},"format":"json"}
```

No `provider`, no `Authorization` header. `signOut` **does** need the bearer JWT (it derives the
session from `ctx.auth.getUserIdentity()`).

### 3c. Verdict

`AuthProvider.extractIdToken(): String` → `AuthTokenProviderBridge.fetchToken(): String?` →
`MobileConvexClient.setAuth` → Rust `AuthenticationToken::User(String)` → WebSocket. A Convex Auth
JWT is a `String`. There is no impedance mismatch to bridge. The shim is roughly 40 lines:

```kotlin
class ConvexAuthJwtProvider(private val store: SessionStore) : AuthProvider<String> {
    private var push: ((String?) -> Unit)? = null

    override suspend fun login(context: Context, onIdToken: (String?) -> Unit): Result<String> {
        push = onIdToken
        return runCatching { store.signIn() }          // POST auth:signIn
    }

    override suspend fun loginFromCache(onIdToken: (String?) -> Unit): Result<String> {
        push = onIdToken
        return runCatching { store.freshAccessToken() } // refresh if near exp; called on every WS reconnect
    }

    override suspend fun logout(context: Context): Result<Void?> {
        push = null; store.clear(); return Result.success(null)
    }

    override fun extractIdToken(authResult: String) = authResult

    fun onRefreshed(jwt: String?) { push?.invoke(jwt) }
}
```

---

## 4. Q2 — Options, cost, and blast radius

Blast radius baseline, measured on `main`:

| Surface                                                                       | Count  | How measured                                 |
| ----------------------------------------------------------------------------- | ------ | -------------------------------------------- |
| Backend files using `requireAuth` / `getAuthenticatedUser*` / `getAuthUserId` | **26** | `git grep -l` over `packages/backend/convex` |
| `requireAuth` call sites                                                      | 95     | `git grep -o -w`                             |
| `requirePermission` call sites                                                | 50     | same                                         |
| `getAuthenticatedUser` call sites                                             | 43     | same                                         |
| `getAuthUserId` call sites (incl. all sync HTTP actions)                      | 17     | same                                         |
| `apps/web` files importing `useAuth`                                          | 20     | `git grep -l`                                |
| `apps/web` files calling `hasPermission`                                      | 3      | same                                         |

### Option A — Custom `AuthProvider` over Convex Auth's HTTP actions **(recommended)**

Implement `AuthProvider<String>` backed by an OkHttp client that POSTs `auth:signIn` and refreshes
with `{refreshToken}`.

- **Backend change:** none. `auth.ts`, `auth.config.ts`, `lib/auth.ts`, `lib/permissions.ts`,
  `schema.ts` auth tables — all untouched. All 95 `requireAuth` call sites keep working verbatim.
- **`apps/web` absorbs:** **nothing.** Zero files change. `ConvexAuthProvider`, `useAuthActions`,
  `useConvexAuth`, `middleware.ts` all keep working. This is the whole point.
- **Kotlin cost:** ~40-line `AuthProvider` + ~150-line token store (see §7 for the mutex
  requirement — that is the part with teeth).
- **Risk:** contract stability, not feasibility. See §7.
- **Precedent:** our own sync layer already does the HTTP half in production.

### Option B — Migrate to Clerk / a real OIDC provider

- **Backend change:** rewrite `auth.ts`; change `auth.config.ts` to Clerk's issuer; drop
  `authTables` from `schema.ts`; migrate every existing user's identity into Clerk and re-key
  `users` on the Clerk subject. `getAuthUserId` → `ctx.auth.getUserIdentity()` mapped through a
  lookup. `lib/auth.ts` rewritten; the 95 `requireAuth` call sites survive only if the helper's
  signature is preserved, which is achievable.
- **`apps/web` absorbs:** **all of it.** Swap `ConvexAuthProvider` → `ClerkProvider` +
  `ConvexProviderWithClerk`; rewrite `src/hooks/useAuth.tsx`; touch the 20 files importing it;
  rewrite the sign-in screen; and re-onboard every cashier and admin. `middleware.ts` would
  actually get _better_ (Clerk has real SSR middleware, our current one is a no-op that says
  "auth is handled client-side"). But it is a full migration of a currently-working app that is
  explicitly **not** in scope for this project.
- **Ongoing cost: not the objection I expected, and I should say so.** Clerk bills on _Monthly
  Retained Users_, not MAU — free tier is 50,000 MRU per app, so three restaurants' worth of staff
  is comfortably $0, and Pro is $25/mo if we ever want MFA or de-branding
  ([clerk.com/pricing](https://clerk.com/pricing)). Cost is **not** a reason to reject Clerk.
- **Maturity is mixed.** The Clerk Android SDK is genuinely solid — GA since
  [2025-09-11](https://clerk.com/changelog/2025-09-11-android-sdk-ga), currently `1.1.6`, commits
  within the last week. But the Convex bridge,
  [`com.clerk:clerk-convex-kotlin`](https://github.com/clerk/clerk-convex-kotlin), is a ~170-line
  adapter at `0.15.0` (2026-07-21) with 2 stars, whose last eight commits on `main` are all
  Renovate bot bumps, and which pins `clerk-android-api:1.0.36` while the SDK ships `1.1.6`.
  Convex's own Android docs do not mention Clerk at all. If we ever take this path, **vendor the
  ~170 lines rather than take the dependency** — you also get to fix its `logout()`, which
  currently signs the user out of Clerk _globally_.
- **Verdict:** rejected on **blast radius**, not cost or quality. It forces a full rewrite of a
  currently-working `apps/web` that is explicitly out of scope, plus re-onboarding every user,
  to buy something we can get for ~40 lines of Kotlin. This is the option the ticket feared we'd
  be forced into. We are not — but it is a reasonable fallback if §7's instability risk ever
  materialises badly.

### Option C — Authenticate over plain HTTP and hand the client a token

This is not a third option; it is Option A's implementation. Convex Auth's `signIn` **is** a plain
HTTP action, and `setAuth`/`AuthProvider<String>` **is** handing the client a token. Worth stating
explicitly so nobody prices it separately.

The only genuinely distinct variant is **bypassing `AuthProvider` entirely** via the public
`setAuth(String)` on the FFI client. Cheaper by ~30 lines, but you lose the `AuthState` flow and,
more importantly, the `loginFromCache` reconnect hook — meaning a WebSocket reconnect after the
1-hour token expires would fail instead of silently refreshing. **Do not do this.** Use
`AuthProvider` and implement `loginFromCache`.

### Option D — Custom JWT signed by us

Convex supports `type: "customJwt"` in `auth.config.ts` (RS256/ES256, requires `kid`/`alg`/`typ`
header claims and `sub`/`iss`/`exp`). We could mint our own. This means owning key rotation,
session revocation and rate limiting — all of which Convex Auth already does, and one of which
(`authRateLimits`) we rely on. Strictly more work than A for strictly less. Rejected.

---

## 5. Q3 — Offline auth

### 5a. Storage: `EncryptedSharedPreferences` vs DataStore + Keystore

**Recommendation: Proto DataStore + a hand-rolled AES-256-GCM `Serializer` over an Android
Keystore key. Do not use `EncryptedSharedPreferences`.**

The ticket frames this as an open choice. It is not, any more — the choice was made for us
upstream.

#### `EncryptedSharedPreferences` is deprecated, and there is no successor

The reference page
([developer.android.com/reference/androidx/security/crypto/EncryptedSharedPreferences](https://developer.android.com/reference/androidx/security/crypto/EncryptedSharedPreferences),
last updated 2026-08-06) reads:

> **Added in 1.0.0 / Deprecated in 1.1.0**
> This class is deprecated. **Use `android.content.SharedPreferences` instead.**

Its siblings went the same way: `EncryptedFile` → _"Use `java.io.File` instead"_; `MasterKey` →
_"Use `javax.crypto.KeyGenerator` with AndroidKeyStore instance instead."_ Read those replacement
strings literally — **Google's advice is "use the unencrypted thing, and roll the crypto
yourself."** There is no drop-in successor.

The release notes confirm it was deliberate, not accidental
([androidx releases/security](https://developer.android.com/jetpack/androidx/releases/security)):
1.1.0-alpha07 (2025-04-09) — _"Deprecated all APIs in favour of existing platform APIs and direct
use of Android Keystore."_ 1.1.0 went stable 2025-07-30. And from
[developer.android.com/privacy-and-security/cryptography](https://developer.android.com/privacy-and-security/cryptography):

> "All APIs in the `security-crypto` Jetpack library were deprecated in the stable release of
> version 1.1.0. **There won't be any subsequent releases of this library.**"

Google Maven confirms `security-crypto` terminates at `1.1.0`.

#### It also has a five-year-old, still-open crash class

This is the part that matters for a POS tablet. Google's own class docs warn:

> "**WARNING**: The preference file should not be backed up with Auto Backup. When restoring the
> file **it is likely the key used to encrypt it will no longer be present.**"

But the failure is not only a backup problem. Open Issue Tracker bugs:

- [b/158234058](https://issuetracker.google.com/issues/158234058) — _"Lots of decryption errors
  after updating to AndroidX Security 1.0.0 RC 2"_, opened 2020-06-07, still active 2025-08-13.
  The reported stack is `java.lang.SecurityException: Could not decrypt key. decryption failed`
  thrown from `EncryptedSharedPreferences.getAll()`.
- [b/370009394](https://issuetracker.google.com/issues/370009394) — opened 2024-09-27, **assigned
  and still active 2026-09-10**. The reporter, across Galaxy A25/A53/S21/S23, Pixel 2 XL and
  Zenfone 8 on Android 10-14: _"app crashes instantly after a launch, when EncryptedSharedPreferences
  are created … **We have disabled backup (`android:allowBackup="false"`), also we have excluded
  shared prefs … in `xml/data_extraction_rules`. It didn't fix the issue.**"_ — and then asks
  Google the same question we are asking, with no published answer.

Note the ergonomics: it throws an unchecked `SecurityException` from plain read methods like
`getString()` and `getAll()`. Key loss becomes an app crash on launch, not "please sign in again."
"Tablet won't open" during a lunch rush is not a failure mode we can accept.

#### What to use instead

**Storage — Proto DataStore, stable coordinates today:**

```
androidx.datastore:datastore:1.2.1
androidx.datastore:datastore-core:1.2.1
```

Proto rather than Preferences, because `CachedSession` is a structured record with a
`List<String>` and a nested JSON blob, not eight loose keys. Build it with `DataStore.Builder` and
an **application-scoped** `CoroutineContext` that has a `Job` — DataStore's docs warn that a
cancelled context terminates its internal operations, so do not hand it a `viewModelScope`.

**Encryption — a custom `Serializer<T>` doing AES-256-GCM with a key from
`KeyGenerator.getInstance("AES", "AndroidKeyStore")`.** That is exactly what `MasterKey`'s
deprecation message instructs. Three specific parameter choices for this app:

- **Do not** set `setUserAuthenticationRequired(true)`. A cashier-facing POS must read its session
  with no biometric prompt, and that flag is the main source of key invalidation.
- **Do not** set `setIsStrongBoxBacked(true)`. Google's own caution: StrongBox is _"slower, more
  resource-constrained, and supports fewer concurrent operations. For most apps, StrongBox is not
  necessary."_ The fallback path (`StrongBoxUnavailableException`) only adds a failure mode.
- **Do** bind associated data (e.g. `"pos_session".encodeToByteArray()`) so the session ciphertext
  cannot be swapped for another blob. DataStore's own `AeadSerializer` calls this out as a
  ciphertext-swapping defence.

**Non-negotiable: treat decrypt failure as a recoverable state.** Wire a
`ReplaceFileCorruptionHandler` that returns an empty session and routes to re-login. Keystore keys
do occasionally vanish; this one decision is what separates us from every crash report above.
Google reached the same conclusion — `datastore-tink` 1.3.0-alpha10 (2026-07-29) changed
`GeneralSecurityException` in `AeadSerializer` to be _"wrapped in `CorruptionException` for better
`CorruptionHandler` integration."_ Mirror that.

**Migrate to `androidx.datastore:datastore-tink` when it reaches stable — not now.** It is the
sanctioned successor and it does exactly what the hand-rolled serializer above does, but it exists
only as `1.3.0-alpha07` … `alpha11` with no beta or RC as of 2026-09-09. Shape our serializer like
`AeadSerializer` so the swap is a one-file change.

#### Be honest about what the encryption actually buys

The stated threat is "a cashier with the tablet," and the sensitive fields are `roleId`,
`permissions[]` and `expiresAt` — those are **integrity** concerns (privilege escalation, session
extension), not confidentiality concerns. Google's Keystore documentation is explicit that
hardware backing prevents key _extraction_ but not key _use_: _"If the app's process is
compromised, the attacker might be able to use the app's keys but can't extract their key
material."_ On a rooted tablet, at-rest encryption alone does not stop a determined cashier from
flipping a permission bit.

What actually defends this threat model, in priority order:

1. **A server-side signature (HMAC) over the session blob, verified on every read.** Tampering
   becomes detectable whether or not the file was encrypted. Cheap, and the highest-value control
   here. Worth adding to the backend as part of this work.
2. **A short `expiresAt`** with re-validation on every successful sync, so a frozen snapshot decays.
3. **Locked-down tablets** — kiosk/device-owner mode, no adb, non-debuggable release builds. App-private
   internal storage plus the Linux UID sandbox already blocks a non-root cashier from reading the file.

Treat DataStore + Keystore as defence-in-depth — it defeats casual `adb pull`, backup extraction
and lost-device forensics — and treat the signature as the actual access-control mechanism.

### 5b. Do `lib/permissions.ts` semantics port unchanged?

**The evaluation rule ports exactly. The data flow does not, and that is where the design work is.**

The rule itself is trivially portable — `convex/lib/permissions.ts`:

```ts
export async function hasPermission(ctx, userId, permission): Promise<boolean> {
  const user = await ctx.db.get(userId);
  if (!user || !user.isActive) return false;
  if (!user.roleId) return false;
  const role = await ctx.db.get(user.roleId);
  if (!role) return false;
  return role.permissions.includes(permission);
}
```

Flat string membership against `role.permissions: v.array(v.string())`. No hierarchy, no
wildcards, no inheritance, no resource scoping. 27 permission keys in the `PERMISSIONS` const.
In Kotlin that is `permission in cachedSession.permissions` — one line.

Four things that are **not** a straight port:

1. **`isActive` and role edits are server-truth.** The cached snapshot can't see a cashier being
   deactivated or a role's permissions being edited. The web admin can do both. An offline tablet
   will keep honouring a stale snapshot until it next syncs. Mitigate with a short `expiresAt`
   (see below) and by refreshing the snapshot on every successful sync — do not treat the cache as
   authoritative indefinitely.
2. **The cache is an availability tier, not a security boundary.** Server-side `requirePermission`
   stays exactly as it is and remains the only real gate. The Kotlin check is there so the UI
   doesn't offer a button whose mutation will be rejected on push. Say this out loud in the code,
   because the temptation to "trust the cache" during a rush is real.
3. **`scopeLevel` is not in the cached struct.** `CachedSession` carries `roleId`, `permissions`,
   `storeId` — but not `scopeLevel`, and `getUserStoreScope` (`lib/auth.ts`) branches on
   `system` / `parent` / `branch`. On a single-store tablet this is moot, and the current struct
   is fine; just don't assume it generalises.
4. **PIN verification has no offline story at all.** `convex/screenLockActions.ts` is a Node action
   doing `bcrypt.compare` server-side. Both the lock-screen unlock and the manager PIN override for
   voids/discounts require network today. If offline unlock is a requirement — and for an
   offline-first POS it surely is — the bcrypt hash must be cached alongside the session and
   compared on-device. That is a genuine security decision (a bcrypt hash of a 4-6 digit PIN on a
   tablet a cashier holds is brute-forceable offline in minutes) and needs its own ticket, not a
   line in this one.

### 5c. The `CachedSession` struct, in Kotlin

The existing TS struct is a reasonable starting shape. Two changes I'd make:

```kotlin
@Serializable
data class CachedSession(
    val userId: String,
    val email: String,
    val name: String,
    val roleId: String,
    val permissions: List<String>,
    val storeId: String,
    val storeSnapshot: JsonObject,
    val expiresAt: Long,        // ms epoch
    val deviceCode: String? = null,
)
```

- **`expiresAt` should be a grace window, not the JWT expiry.** The JWT is 1 hour; a tablet that
  loses Wi-Fi for two hours mid-service must keep working. Pick a value against the actual
  business risk — a shift length (12h) is defensible, 30 days (the refresh-token lifetime) is not.
  The current `isSessionValid` is just `s.expiresAt > Date.now()`, so the policy lives entirely in
  whoever sets the field. Decide it deliberately.
- **Persist `deviceCode`.** It is already an optional field on the struct and nothing sets it. See
  §6.

---

## 6. Q4 — Device identity

### 6a. How it works today

`apps/native/src/auth/deviceId.ts` generates a v4 UUID on first call and persists it in
`expo-secure-store` under the key `pmgt.deviceId`. That UUID is the stable identity for
`/sync/registerDevice` and the `x-device-id` header on `/sync/push`.

Server side, `convex/sync.ts`:

```ts
export const registerDeviceCore = internalMutation({
  args: { deviceId: v.string(), storeId: v.id("stores") },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("syncDevices")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", args.deviceId))
      .first();
    if (existing && existing.storeId === args.storeId) {
      await ctx.db.patch(existing._id, { lastSeenAt: Date.now() });
      return { deviceCode: existing.deviceCode }; // idempotent
    }
    const nextIndex = store.deviceCodeCounter ?? 0;
    const deviceCode = deviceCodeFromIndex(nextIndex); // A, B, …, Z, AA, AB
    await ctx.db.patch(args.storeId, {
      deviceCodeCounter: nextIndex + 1,
      updatedAt: Date.now(),
    });
    await ctx.db.insert("syncDevices", {
      deviceId,
      storeId,
      deviceCode,
      registeredAt,
      lastSeenAt,
    });
    return { deviceCode };
  },
});
```

Everything that matters is **server-side and keyed on the client's UUID**: the `deviceCode`
(`A`, `B`, …, which prefixes order numbers as `D-A001`) and `orderNumberCounters`, a per-`(device,
prefix)` record on the `syncDevices` row. `stores.deviceCodeCounter` is monotonic and never
decremented — codes are never reused, deliberately, to preserve the audit trail.

**Therefore: device registration survives the rewrite if and only if the Kotlin app produces the
same UUID string.** Nothing else needs to migrate. Same UUID → idempotent branch → same
`deviceCode`, same counters, continuous order numbering. Different UUID → a brand-new
`syncDevices` row, the store's `deviceCodeCounter` burns a code, and a tablet that was `D-A###`
starts emitting `D-B###` mid-life.

### 6b. Reading the existing UUID from Kotlin

This is fully specified and does not require Expo. Read from the shipped
`expo-secure-store@15.0.8` Android source in `node_modules`:

- **File:** `SharedPreferences` named `SecureStore`, `MODE_PRIVATE`
  → `/data/data/com.pmgtitconsultancy.pmgtflow/shared_prefs/SecureStore.xml`
  (`SecureStoreModule.kt`: `private const val SHARED_PREFERENCES_NAME = "SecureStore"`)
- **Pref key:** `"${keychainService}-${key}"` (`createKeychainAwareKey`), and `keychainService`
  defaults to `SecureStoreModule.DEFAULT_KEYSTORE_ALIAS = "key_v1"` (`SecureStoreOptions.kt:10`).
  We never pass options, so the key is **`key_v1-pmgt.deviceId`**.
- **Value:** a JSON string
  `{"ct":<b64>,"iv":<b64>,"tlen":<int>,"scheme":"aes","usesKeystoreSuffix":true,"keystoreAlias":"key_v1"}`
- **Cipher:** `AES/GCM/NoPadding`, 256-bit, IV per write, GCM tag length in `tlen`
  (`AESEncryptor.kt`)
- **Keystore alias:** `"$AES_CIPHER:$baseAlias:$suffix"` =
  **`AES/GCM/NoPadding:key_v1:keystoreUnauthenticated`**, in the `AndroidKeyStore` provider
  (`AESEncryptor.getKeyStoreAlias` / `getExtendedKeyStoreAlias`, and
  `UNAUTHENTICATED_KEYSTORE_SUFFIX = "keystoreUnauthenticated"`)

So a ~40-line Kotlin reader can open the same `SharedPreferences`, parse the JSON, load the
existing `AndroidKeyStore` key by that alias and decrypt — **provided the Kotlin app ships under
the same `applicationId` (`com.pmgtitconsultancy.pmgtflow`, `app.config.ts:12`) as an in-place
upgrade.** A different package name, or an uninstall/reinstall, loses both the prefs file and the
Keystore key, and the UUID is gone.

**Recommendation:** on first launch of the Kotlin build, attempt the read; on success, re-persist
the UUID into the new Kotlin-native store and carry on; on failure, generate fresh. Keep the
reader for a release or two, then delete it. Write a migration test against a real
`SecureStore.xml` captured from a live tablet before trusting it.

If in-place upgrade turns out not to be viable, the fallback is a **server-assisted re-key**: sign
in, read `syncDevices` for the store, and let a manager pick "this tablet is device B" — then write
that `deviceId` into the new store. Ugly, needs a new backend endpoint, and needs a human at each
of the three stores; but it beats silently burning device codes.

### 6c. Three latent bugs worth fixing during the rewrite

1. **`deviceCode` is never persisted.** `SyncManager` holds it in a private field
   (`private deviceCode = ""`), set only from a successful `callRegisterDevice`. On a cold start
   with no network, `getNextOrderNumber` falls through to `getFallbackDeviceCode()`, which derives
   a 4-char code from the UUID:
   ```ts
   return (
     deviceId
       .replace(/[^a-z0-9]/gi, "")
       .slice(0, 4)
       .toUpperCase() || "X"
   );
   ```
   So a tablet normally printing `D-A001` prints `D-3F7B001` after an offline cold start. The
   `CachedSession` struct already has a `deviceCode?` field for this. **Persist it in Kotlin.**
2. **Auto Backup is not disabled, and `allowBackup="false"` would not be enough anyway.**
   `app.config.ts` sets no `android.allowBackup`, so Android's default applies and
   `shared_prefs/SecureStore.xml` is backed up. A backup restored onto a _second_ tablet clones the
   `deviceId`, giving two devices one `syncDevices` row and one set of `orderNumberCounters` — i.e.
   duplicate order numbers on the two tablets, silently.

   Google names this exact scenario in the
   [Auto Backup docs](https://developer.android.com/guide/topics/data/autobackup) as a thing to
   exclude: _"Files that have device-specific identifiers, either issued by a server or generated
   on the device. … If the old registration token is restored, the app might behave unexpectedly."_

   The obvious fix is insufficient. From the same page:

   > "For apps targeting Android 12 (API level 31) or higher … On devices from some device
   > manufacturers, **specifying `android:allowBackup="false"` disables cloud-based backup and
   > restore … but doesn't disable device-to-device transfers for the app.**"

   That matches the b/370009394 reporter in §5a, who set `allowBackup="false"` plus
   `dataExtractionRules` and still got invalid keys. **Do all of the following in the Kotlin app:**
   - Store the device UUID under **`getNoBackupFilesDir()`**, which is unconditionally excluded
     from every backup and transfer channel and cannot be re-included by mistake. This is the
     single most robust control.
   - Give it its own file, separate from the session store, and **do not encrypt it** — encrypting
     it gains nothing against our threat model and adds a key-loss failure that would silently
     re-identify the tablet and burn a device code.
   - Ship `android:dataExtractionRules` (API 31+) **and** `android:fullBackupContent` (API 30-),
     with explicit `<exclude>` entries under all three of `<cloud-backup>`, `<device-transfer>` and
     `<cross-platform-transfer>`. A missing section means that mode is _fully enabled_, not off.

3. **`fallbackUuid()` uses `Math.random()`.** Its own comment admits this. In Kotlin, use
   `java.util.UUID.randomUUID()`, which is `SecureRandom`-backed. Free fix.

**And one thing to explicitly _not_ change:** do not "simplify" the generated UUID to
`Settings.Secure.ANDROID_ID`. It looks tempting for a device identity and is wrong here on three
counts — it survives an app reinstall (so a compromised or duplicated device identity can never be
reset), it silently changes on factory reset and on APK signing-key change
([`Settings.Secure` reference](https://developer.android.com/reference/android/provider/Settings.Secure)),
and it is a cross-app-linkable persistent identifier. Google's own guidance is to
_"use a Firebase installation ID (FID) or a privately stored GUID whenever possible"_
([identity/user-data-ids](https://developer.android.com/identity/user-data-ids)). A
`UUID.randomUUID()` in app-private no-backup storage — which is what we already do — is the right
design. Keep it.

---

## 7. The real risk: Convex Auth's contract is explicitly unstable

This is the thing to weigh, and it is not what the ticket asked about.

Convex Auth is **still beta**. Its own docs say so, and the exported types carry this:

> "This type is exported for implementors of other client integrations. However it is **not
> stable, and may change** until this library reaches 1.0."

That warning is aimed precisely at what Option A does.

And `2.0.0-alpha.1` is already on npm (2026-08-24) and changes essentially every fact in §3b:

|                  | 0.0.x (us, and 0.0.95)                                     | 2.0.0-alpha.1                                                    |
| ---------------- | ---------------------------------------------------------- | ---------------------------------------------------------------- |
| Access-token TTL | 1 hour                                                     | **60 seconds**                                                   |
| `sub`            | `` `${userId}\|${sessionId}` ``                            | bare `userId`                                                    |
| JWT header       | `{alg}`                                                    | `{alg, kid, typ}` — a Convex **custom-JWT** identity             |
| Refresh token    | `` `${docId}\|${sessionId}` `` (the row ID _is_ the token) | 32 opaque random bytes; only the SHA-256 is stored               |
| Rotation grace   | 10s reuse window + descendant-tree invalidation            | `previousRefreshTokenHash`, 30s grace                            |
| API shape        | one overloaded `auth:signIn` **action**                    | separate **mutations**: `signUp`, `signIn`, `refresh`, `signOut` |
| Env vars         | `JWT_PRIVATE_KEY`, `JWKS`                                  | `AUTH_PRIVATE_KEY`, `AUTH_JWKS`                                  |
| Tables           | `authSessions` etc. in our schema                          | inside a mounted Convex **component**                            |

A 60-second access token with a 30-second rotation grace is a materially harder client contract
than 1 hour / 10 seconds: refresh becomes a once-a-minute background job and rotation races become
the normal case rather than the edge case.

**Consequences for the plan:**

- Put the wire protocol behind **one Kotlin interface** (`SessionStore` in §3c). Assume it gets
  rewritten. If v2 lands mid-migration, one file changes.
- **The refresh race is the sharpest edge in 0.0.x.** Refresh tokens are single-use with a 10-second
  reuse window; an invalid use invalidates the token _and all its descendants_, killing the session.
  A refresh that succeeds server-side but whose response the client loses — backgrounded app,
  tablet walked out of Wi-Fi range mid-call, which is a Tuesday in a restaurant — leaves you holding
  a spent token with 10 seconds to retry before the cashier is logged out mid-order. The React
  client hedges with a mutex on the refresh-token storage key plus a network-error retry loop. The
  Kotlin client needs the same: **a `Mutex` around refresh, persist-before-use, and retry on
  network error (not on auth error).** This is the single highest-risk piece of code in the auth
  work — budget for it and test it with the radio off.
- Do not upgrade `@convex-dev/auth` past 0.0.9x during the migration. Pin it. Two moving protocols
  at once is how this goes wrong.
- `apps/web` shares the library, so a future v2 upgrade is a _joint_ web+Kotlin project. That is a
  reason to keep the Kotlin protocol layer thin, not a reason to pick Clerk today.

---

## 8. Recommended architecture

```
┌─────────────────────────── Kotlin POS ────────────────────────────┐
│                                                                    │
│  LoginScreen ──► SessionStore ─── POST /api/action auth:signIn     │
│                      │                  {provider:"password", …}   │
│                      │            ◄── {token, refreshToken}        │
│                      │                                             │
│                      ├─► Proto DataStore + AES-GCM Keystore(§5a)  │
│                      │     • accessToken + exp                     │
│                      │     • refreshToken   ← Mutex-guarded        │
│                      │     • CachedSession  ← offline permissions  │
│                      │       (HMAC-signed by the server)           │
│                      │     • deviceCode                            │
│                      │     ReplaceFileCorruptionHandler → re-login │
│                      │                                             │
│                      ├─► getNoBackupFilesDir()  ← plain, excluded  │
│                      │     • deviceId (migrated from SecureStore)  │
│                      │                                             │
│                      └─► refresh: POST auth:signIn {refreshToken}  │
│                                                                    │
│  ConvexAuthJwtProvider : AuthProvider<String>                      │
│      extractIdToken(t) = t                                         │
│      loginFromCache()  = store.freshAccessToken()  ← WS reconnect  │
│                      │                                             │
│                      ▼                                             │
│  ConvexClientWithAuth ──── WebSocket ────► .convex.cloud           │
│  OkHttp + Bearer      ──── /sync/* ──────► .convex.site            │
└────────────────────────────────────────────────────────────────────┘

Auth backend: UNCHANGED.   apps/web: UNCHANGED.
(One additive backend change: HMAC-sign the session snapshot — work item 8.)
```

**Decision: keep `@convex-dev/auth`.** Implement `AuthProvider<String>` (Option A). `apps/web`
absorbs nothing.

Work items this implies, roughly in order:

1. `SessionStore` — `signIn` / `refresh` / `signOut` over OkHttp, with a `Mutex` around refresh and
   persist-before-use. **Highest risk; do it first and test with the radio off.**
2. `SecureSessionStorage` — Proto DataStore 1.2.1 + AES-GCM Keystore `Serializer` +
   `ReplaceFileCorruptionHandler` (§5a). **Not `EncryptedSharedPreferences` — it is deprecated.**
3. `ConvexAuthJwtProvider : AuthProvider<String>` — trivial once (1) exists.
4. `deviceId` migration reader for `key_v1-pmgt.deviceId` (§6b), plus a test against a real
   `SecureStore.xml` pulled off a live tablet.
5. Device UUID into `getNoBackupFilesDir()`, unencrypted, plus `dataExtractionRules` and
   `fullBackupContent` excludes; persist `deviceCode`; `UUID.randomUUID()` (§6c).
6. **Offline session cache — new feature, not a port** (§2a, §5b). Needs its own design pass:
   `expiresAt` policy, refresh-on-sync, and the stale-permission window.
7. **Offline PIN verification — separate ticket** (§5b item 4). Has a real security trade-off.
8. **Backend: sign the session snapshot (HMAC) and verify on every read** (§5a). Small backend
   change, and it is the control that actually enforces offline permissions — more valuable than
   the at-rest encryption it sits behind.

Items 6, 7 and 8 are the actual scope hiding inside this ticket. Items 1-5 are mechanical.

---

## 9. What I could not verify

- **No successful `{tokens: {…}}` response was observed on the wire.** The probes against our
  deployment were deliberately side-effect-free (missing-arg and bad-provider error paths, plus the
  two public `.well-known` GETs). The response shape is read from
  `src/server/implementation/index.ts` and `types.ts`, not observed. **Confirm with one real
  `curl` against a dev deployment before writing the Kotlin client.**
- **No official Convex statement blesses Convex Auth for Kotlin/Swift.** I searched
  `get-convex/convex-auth` issues for native/mobile/kotlin/swift/android/ios — 21 hits, all React
  Native/Expo/Next.js. The supported-platforms line is _"client-side React web apps served from a
  CDN and React Native mobile apps."_ We would be the first ones down this path, using a documented
  but explicitly unstable wire format. That is a real risk; it is not a technical blocker.
- **`get-convex/convex-mobile` has no open issue or discussion about `@convex-dev/auth`** — neither
  support nor a warning against it.
- **Kotlin Multiplatform is not supported** by `convex-mobile` (issue #5, open since 2025-05-23).
  Irrelevant for Android-only, noted in case the iOS question ever comes up.
- The `deviceId` migration path in §6b is derived from reading `expo-secure-store@15.0.8`'s Android
  source. **It has not been executed against a real device.** Verify before relying on it.
- **Issue Tracker status labels** (b/158234058 etc.) were decoded from a numeric enum in
  `issuetracker.google.com`'s JSON payload, not read from the human UI. Titles, dates and reporter
  text are verbatim; the words "open" / "assigned" are inferred. Google's own replies on those
  threads were not reachable — we have reporter text only.
- **No Google statement exists that Android Keystore is unreliable.** The Keystore page says
  nothing about key survival across OS upgrade or backup/restore (`upgrade`: zero occurrences), and
  [Tink's known-issues page](https://developers.google.com/tink/known-issues) does not mention it.
  The only first-party signal is the indirect warning in the `EncryptedSharedPreferences` docs. The
  "Keystore is flaky" belief circulates widely; the evidence is Issue Tracker bugs, not
  documentation. §5a's `CorruptionHandler` advice is the right response either way.
- **`developer.android.com/topic/security/data` does not mention `EncryptedSharedPreferences`,
  DataStore, or the deprecation at all** — which is why this deprecation is easy to miss. It was
  itself filed as a docs bug ([b/404218348](https://issuetracker.google.com/issues/404218348)).
- Whether Clerk considers `clerk-convex-kotlin` GA or experimental — **no status label anywhere**
  in its README, docs or releases.

---

## 10. Sources

**This repo** (all at `main` @ `ba59163`):
`packages/backend/convex/lib/auth.ts` ·
`packages/backend/convex/lib/permissions.ts` ·
`packages/backend/convex/schema.ts` ·
`packages/backend/convex/auth.ts` ·
`packages/backend/convex/auth.config.ts` ·
`packages/backend/convex/http.ts` ·
`packages/backend/convex/sync.ts` ·
`packages/backend/convex/sessions.ts` ·
`packages/backend/convex/screenLockActions.ts` ·
`apps/native/src/auth/cachedSession.ts` ·
`apps/native/src/auth/deviceId.ts` ·
`apps/native/src/sync/SyncBootstrap.tsx` ·
`apps/native/src/sync/syncEndpoints.ts` ·
`apps/native/src/sync/SyncManager.ts` ·
`apps/native/src/features/auth/context/AuthContext.tsx` ·
`apps/native/src/features/orders/services/orderNumber.ts` ·
`apps/native/app.config.ts` ·
`apps/web/src/app/ConvexClientProvider.tsx` ·
`apps/web/src/hooks/useAuth.tsx` ·
`apps/web/src/middleware.ts` ·
`node_modules/expo-secure-store@15.0.8/android/src/main/java/expo/modules/securestore/{SecureStoreModule,SecureStoreOptions,encryptors/AESEncryptor,encryptors/KeyBasedEncryptor}.kt`

**Convex Android client:**
[docs.convex.dev/client/android](https://docs.convex.dev/client/android) ·
[`ConvexClient.kt`](https://raw.githubusercontent.com/get-convex/convex-mobile/main/android/convexmobile/src/main/java/dev/convex/android/ConvexClient.kt) ·
[`convex-mobile.udl`](https://raw.githubusercontent.com/get-convex/convex-mobile/main/rust/src/convex-mobile.udl) ·
[`convex-rs` `client/mod.rs`](https://raw.githubusercontent.com/get-convex/convex-rs/main/src/client/mod.rs) ·
[`android-convexmobile` maven-metadata](https://repo1.maven.org/maven2/dev/convex/android-convexmobile/maven-metadata.xml) ·
[`Auth0Provider.kt`](https://github.com/get-convex/convex-android-auth0/blob/main/convex-auth0/src/main/java/dev/convex/android/auth0/Auth0Provider.kt) ·
[`ClerkConvexAuthProvider.kt`](https://github.com/clerk/clerk-convex-kotlin/blob/main/source/clerk-convex-kotlin/src/main/kotlin/com/clerk/convex/ClerkConvexAuthProvider.kt) ·
[docs.convex.dev/auth/advanced/custom-jwt](https://docs.convex.dev/auth/advanced/custom-jwt)

**Convex Auth:**
[labs.convex.dev/auth](https://labs.convex.dev/auth) ·
[get-convex/convex-auth @ v0.0.95](https://github.com/get-convex/convex-auth/tree/v0.0.95)
(`src/server/implementation/{tokens,signIn,index,types,refreshTokens}.ts`, `src/react/client.tsx`) ·
[@ v2.0.0-alpha.1](https://github.com/get-convex/convex-auth/tree/v2.0.0-alpha.1) ·
[docs.convex.dev/auth/convex-auth](https://docs.convex.dev/auth/convex-auth) ·
[docs.convex.dev/http-api](https://docs.convex.dev/http-api/)

**Android platform:**
[`EncryptedSharedPreferences` reference](https://developer.android.com/reference/androidx/security/crypto/EncryptedSharedPreferences)
(deprecation notice) ·
[androidx releases/security](https://developer.android.com/jetpack/androidx/releases/security)
(1.1.0 stable 2025-07-30, terminal) ·
[privacy-and-security/cryptography](https://developer.android.com/privacy-and-security/cryptography)
("There won't be any subsequent releases of this library") ·
[DataStore guide](https://developer.android.com/topic/libraries/architecture/datastore) ·
[androidx releases/datastore](https://developer.android.com/jetpack/androidx/releases/datastore)
(`datastore-tink`, `AeadSerializer`, `CorruptionException` wrapping) ·
[privacy-and-security/keystore](https://developer.android.com/privacy-and-security/keystore) ·
[guide/topics/data/autobackup](https://developer.android.com/guide/topics/data/autobackup) ·
[identity/user-data-ids](https://developer.android.com/identity/user-data-ids) ·
[`Settings.Secure` reference](https://developer.android.com/reference/android/provider/Settings.Secure) ·
Issue Tracker [b/158234058](https://issuetracker.google.com/issues/158234058),
[b/370009394](https://issuetracker.google.com/issues/370009394),
[b/404218348](https://issuetracker.google.com/issues/404218348)

**Clerk:**
[clerk/clerk-convex-kotlin](https://github.com/clerk/clerk-convex-kotlin) ·
[Android SDK GA changelog](https://clerk.com/changelog/2025-09-11-android-sdk-ga) ·
[clerk.com/pricing](https://clerk.com/pricing)
