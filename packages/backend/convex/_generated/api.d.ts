/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auditLogs from "../auditLogs.js";
import type * as auth from "../auth.js";
import type * as categories from "../categories.js";
import type * as checkout from "../checkout.js";
import type * as discounts from "../discounts.js";
import type * as helpers_permissionsHelpers from "../helpers/permissionsHelpers.js";
import type * as helpers_seedHelpers from "../helpers/seedHelpers.js";
import type * as helpers_usersHelpers from "../helpers/usersHelpers.js";
import type * as helpers_voidsHelpers from "../helpers/voidsHelpers.js";
import type * as http from "../http.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_permissions from "../lib/permissions.js";
import type * as lib_taxCalculations from "../lib/taxCalculations.js";
import type * as modifierAssignments from "../modifierAssignments.js";
import type * as modifierGroups from "../modifierGroups.js";
import type * as modifierOptions from "../modifierOptions.js";
import type * as notes from "../notes.js";
import type * as openai from "../openai.js";
import type * as orders from "../orders.js";
import type * as products from "../products.js";
import type * as reports from "../reports.js";
import type * as roles from "../roles.js";
import type * as seed from "../seed.js";
import type * as sessions from "../sessions.js";
import type * as stores from "../stores.js";
import type * as tables from "../tables.js";
import type * as users from "../users.js";
import type * as utils from "../utils.js";
import type * as voids from "../voids.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auditLogs: typeof auditLogs;
  auth: typeof auth;
  categories: typeof categories;
  checkout: typeof checkout;
  discounts: typeof discounts;
  "helpers/permissionsHelpers": typeof helpers_permissionsHelpers;
  "helpers/seedHelpers": typeof helpers_seedHelpers;
  "helpers/usersHelpers": typeof helpers_usersHelpers;
  "helpers/voidsHelpers": typeof helpers_voidsHelpers;
  http: typeof http;
  "lib/auth": typeof lib_auth;
  "lib/permissions": typeof lib_permissions;
  "lib/taxCalculations": typeof lib_taxCalculations;
  modifierAssignments: typeof modifierAssignments;
  modifierGroups: typeof modifierGroups;
  modifierOptions: typeof modifierOptions;
  notes: typeof notes;
  openai: typeof openai;
  orders: typeof orders;
  products: typeof products;
  reports: typeof reports;
  roles: typeof roles;
  seed: typeof seed;
  sessions: typeof sessions;
  stores: typeof stores;
  tables: typeof tables;
  users: typeof users;
  utils: typeof utils;
  voids: typeof voids;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
