/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as crons from "../crons.js";
import type * as domains_auth_actions from "../domains/auth/actions.js";
import type * as domains_auth_internal from "../domains/auth/internal.js";
import type * as domains_auth_mutations from "../domains/auth/mutations.js";
import type * as domains_auth_queries from "../domains/auth/queries.js";
import type * as domains_catalog_mutations from "../domains/catalog/mutations.js";
import type * as domains_catalog_queries from "../domains/catalog/queries.js";
import type * as domains_catalog_types from "../domains/catalog/types.js";
import type * as domains_finance_mutations from "../domains/finance/mutations.js";
import type * as domains_finance_queries from "../domains/finance/queries.js";
import type * as domains_iiko_internal from "../domains/iiko/internal.js";
import type * as domains_iiko_mutations from "../domains/iiko/mutations.js";
import type * as domains_kitchen_mutations from "../domains/kitchen/mutations.js";
import type * as domains_kitchen_queries from "../domains/kitchen/queries.js";
import type * as domains_loyalty_mutations from "../domains/loyalty/mutations.js";
import type * as domains_loyalty_queries from "../domains/loyalty/queries.js";
import type * as domains_office_mutations from "../domains/office/mutations.js";
import type * as domains_office_queries from "../domains/office/queries.js";
import type * as domains_orders_mutations from "../domains/orders/mutations.js";
import type * as domains_orders_queries from "../domains/orders/queries.js";
import type * as domains_orders_types from "../domains/orders/types.js";
import type * as domains_reports_queries from "../domains/reports/queries.js";
import type * as domains_seed_mutations from "../domains/seed/mutations.js";
import type * as domains_shifts_mutations from "../domains/shifts/mutations.js";
import type * as domains_shifts_queries from "../domains/shifts/queries.js";
import type * as domains_stock_mutations from "../domains/stock/mutations.js";
import type * as domains_stock_queries from "../domains/stock/queries.js";
import type * as domains_workforce_mutations from "../domains/workforce/mutations.js";
import type * as domains_workforce_queries from "../domains/workforce/queries.js";
import type * as http from "../http.js";
import type * as lib_audit from "../lib/audit.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_finance from "../lib/finance.js";
import type * as lib_loyalty from "../lib/loyalty.js";
import type * as lib_money from "../lib/money.js";
import type * as lib_officeAccess from "../lib/officeAccess.js";
import type * as lib_policy from "../lib/policy.js";
import type * as lib_restaurants from "../lib/restaurants.js";
import type * as lib_time from "../lib/time.js";
import type * as lib_validators from "../lib/validators.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  crons: typeof crons;
  "domains/auth/actions": typeof domains_auth_actions;
  "domains/auth/internal": typeof domains_auth_internal;
  "domains/auth/mutations": typeof domains_auth_mutations;
  "domains/auth/queries": typeof domains_auth_queries;
  "domains/catalog/mutations": typeof domains_catalog_mutations;
  "domains/catalog/queries": typeof domains_catalog_queries;
  "domains/catalog/types": typeof domains_catalog_types;
  "domains/finance/mutations": typeof domains_finance_mutations;
  "domains/finance/queries": typeof domains_finance_queries;
  "domains/iiko/internal": typeof domains_iiko_internal;
  "domains/iiko/mutations": typeof domains_iiko_mutations;
  "domains/kitchen/mutations": typeof domains_kitchen_mutations;
  "domains/kitchen/queries": typeof domains_kitchen_queries;
  "domains/loyalty/mutations": typeof domains_loyalty_mutations;
  "domains/loyalty/queries": typeof domains_loyalty_queries;
  "domains/office/mutations": typeof domains_office_mutations;
  "domains/office/queries": typeof domains_office_queries;
  "domains/orders/mutations": typeof domains_orders_mutations;
  "domains/orders/queries": typeof domains_orders_queries;
  "domains/orders/types": typeof domains_orders_types;
  "domains/reports/queries": typeof domains_reports_queries;
  "domains/seed/mutations": typeof domains_seed_mutations;
  "domains/shifts/mutations": typeof domains_shifts_mutations;
  "domains/shifts/queries": typeof domains_shifts_queries;
  "domains/stock/mutations": typeof domains_stock_mutations;
  "domains/stock/queries": typeof domains_stock_queries;
  "domains/workforce/mutations": typeof domains_workforce_mutations;
  "domains/workforce/queries": typeof domains_workforce_queries;
  http: typeof http;
  "lib/audit": typeof lib_audit;
  "lib/auth": typeof lib_auth;
  "lib/finance": typeof lib_finance;
  "lib/loyalty": typeof lib_loyalty;
  "lib/money": typeof lib_money;
  "lib/officeAccess": typeof lib_officeAccess;
  "lib/policy": typeof lib_policy;
  "lib/restaurants": typeof lib_restaurants;
  "lib/time": typeof lib_time;
  "lib/validators": typeof lib_validators;
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
