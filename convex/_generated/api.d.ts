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
import type * as domains_catalog_migrations from "../domains/catalog/migrations.js";
import type * as domains_catalog_mutations from "../domains/catalog/mutations.js";
import type * as domains_catalog_office from "../domains/catalog/office.js";
import type * as domains_catalog_pos from "../domains/catalog/pos.js";
import type * as domains_catalog_queries from "../domains/catalog/queries.js";
import type * as domains_catalog_types from "../domains/catalog/types.js";
import type * as domains_finance_mutations from "../domains/finance/mutations.js";
import type * as domains_finance_queries from "../domains/finance/queries.js";
import type * as domains_finance_records from "../domains/finance/records.js";
import type * as domains_finance_seed from "../domains/finance/seed.js";
import type * as domains_finance_validators from "../domains/finance/validators.js";
import type * as domains_iiko_internal from "../domains/iiko/internal.js";
import type * as domains_iiko_mutations from "../domains/iiko/mutations.js";
import type * as domains_integrations_internal from "../domains/integrations/internal.js";
import type * as domains_integrations_mutations from "../domains/integrations/mutations.js";
import type * as domains_integrations_queries from "../domains/integrations/queries.js";
import type * as domains_integrations_validators from "../domains/integrations/validators.js";
import type * as domains_kitchen_access from "../domains/kitchen/access.js";
import type * as domains_kitchen_mutations from "../domains/kitchen/mutations.js";
import type * as domains_kitchen_queries from "../domains/kitchen/queries.js";
import type * as domains_loyalty_mutations from "../domains/loyalty/mutations.js";
import type * as domains_loyalty_queries from "../domains/loyalty/queries.js";
import type * as domains_modifiers_mutations from "../domains/modifiers/mutations.js";
import type * as domains_modifiers_queries from "../domains/modifiers/queries.js";
import type * as domains_office_access from "../domains/office/access.js";
import type * as domains_office_adminMaintenance from "../domains/office/adminMaintenance.js";
import type * as domains_office_internal from "../domains/office/internal.js";
import type * as domains_office_migrations from "../domains/office/migrations.js";
import type * as domains_office_mutations from "../domains/office/mutations.js";
import type * as domains_office_queries from "../domains/office/queries.js";
import type * as domains_orders_mutations from "../domains/orders/mutations.js";
import type * as domains_orders_queries from "../domains/orders/queries.js";
import type * as domains_orders_types from "../domains/orders/types.js";
import type * as domains_platform_internal from "../domains/platform/internal.js";
import type * as domains_platform_mutations from "../domains/platform/mutations.js";
import type * as domains_platform_queries from "../domains/platform/queries.js";
import type * as domains_pricing_crons from "../domains/pricing/crons.js";
import type * as domains_pricing_mutations from "../domains/pricing/mutations.js";
import type * as domains_pricing_queries from "../domains/pricing/queries.js";
import type * as domains_recipes_mutations from "../domains/recipes/mutations.js";
import type * as domains_recipes_queries from "../domains/recipes/queries.js";
import type * as domains_reports_queries from "../domains/reports/queries.js";
import type * as domains_seed_mutations from "../domains/seed/mutations.js";
import type * as domains_shifts_mutations from "../domains/shifts/mutations.js";
import type * as domains_shifts_queries from "../domains/shifts/queries.js";
import type * as domains_sizeScales_mutations from "../domains/sizeScales/mutations.js";
import type * as domains_sizeScales_queries from "../domains/sizeScales/queries.js";
import type * as domains_stock_internal from "../domains/stock/internal.js";
import type * as domains_stock_master from "../domains/stock/master.js";
import type * as domains_stock_mutations from "../domains/stock/mutations.js";
import type * as domains_stock_queries from "../domains/stock/queries.js";
import type * as domains_stockDocuments_access from "../domains/stockDocuments/access.js";
import type * as domains_stockDocuments_mutations from "../domains/stockDocuments/mutations.js";
import type * as domains_stockDocuments_queries from "../domains/stockDocuments/queries.js";
import type * as domains_stockDocuments_validators from "../domains/stockDocuments/validators.js";
import type * as domains_workforce_mutations from "../domains/workforce/mutations.js";
import type * as domains_workforce_queries from "../domains/workforce/queries.js";
import type * as http from "../http.js";
import type * as lib_accounts from "../lib/accounts.js";
import type * as lib_audit from "../lib/audit.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_availability from "../lib/availability.js";
import type * as lib_capabilities from "../lib/capabilities.js";
import type * as lib_domainRecords from "../lib/domainRecords.js";
import type * as lib_finance from "../lib/finance.js";
import type * as lib_ledger from "../lib/ledger.js";
import type * as lib_lifecycles from "../lib/lifecycles.js";
import type * as lib_loyalty from "../lib/loyalty.js";
import type * as lib_modifierPricing from "../lib/modifierPricing.js";
import type * as lib_money from "../lib/money.js";
import type * as lib_numbering from "../lib/numbering.js";
import type * as lib_officeAccess from "../lib/officeAccess.js";
import type * as lib_outbox from "../lib/outbox.js";
import type * as lib_periods from "../lib/periods.js";
import type * as lib_policy from "../lib/policy.js";
import type * as lib_pricing from "../lib/pricing.js";
import type * as lib_recipeMath from "../lib/recipeMath.js";
import type * as lib_recipes from "../lib/recipes.js";
import type * as lib_restaurants from "../lib/restaurants.js";
import type * as lib_stockAccounting from "../lib/stockAccounting.js";
import type * as lib_stockPosting from "../lib/stockPosting.js";
import type * as lib_systemRoles from "../lib/systemRoles.js";
import type * as lib_time from "../lib/time.js";
import type * as lib_validators from "../lib/validators.js";
import type * as migrations_m3StockWarehouses from "../migrations/m3StockWarehouses.js";

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
  "domains/catalog/migrations": typeof domains_catalog_migrations;
  "domains/catalog/mutations": typeof domains_catalog_mutations;
  "domains/catalog/office": typeof domains_catalog_office;
  "domains/catalog/pos": typeof domains_catalog_pos;
  "domains/catalog/queries": typeof domains_catalog_queries;
  "domains/catalog/types": typeof domains_catalog_types;
  "domains/finance/mutations": typeof domains_finance_mutations;
  "domains/finance/queries": typeof domains_finance_queries;
  "domains/finance/records": typeof domains_finance_records;
  "domains/finance/seed": typeof domains_finance_seed;
  "domains/finance/validators": typeof domains_finance_validators;
  "domains/iiko/internal": typeof domains_iiko_internal;
  "domains/iiko/mutations": typeof domains_iiko_mutations;
  "domains/integrations/internal": typeof domains_integrations_internal;
  "domains/integrations/mutations": typeof domains_integrations_mutations;
  "domains/integrations/queries": typeof domains_integrations_queries;
  "domains/integrations/validators": typeof domains_integrations_validators;
  "domains/kitchen/access": typeof domains_kitchen_access;
  "domains/kitchen/mutations": typeof domains_kitchen_mutations;
  "domains/kitchen/queries": typeof domains_kitchen_queries;
  "domains/loyalty/mutations": typeof domains_loyalty_mutations;
  "domains/loyalty/queries": typeof domains_loyalty_queries;
  "domains/modifiers/mutations": typeof domains_modifiers_mutations;
  "domains/modifiers/queries": typeof domains_modifiers_queries;
  "domains/office/access": typeof domains_office_access;
  "domains/office/adminMaintenance": typeof domains_office_adminMaintenance;
  "domains/office/internal": typeof domains_office_internal;
  "domains/office/migrations": typeof domains_office_migrations;
  "domains/office/mutations": typeof domains_office_mutations;
  "domains/office/queries": typeof domains_office_queries;
  "domains/orders/mutations": typeof domains_orders_mutations;
  "domains/orders/queries": typeof domains_orders_queries;
  "domains/orders/types": typeof domains_orders_types;
  "domains/platform/internal": typeof domains_platform_internal;
  "domains/platform/mutations": typeof domains_platform_mutations;
  "domains/platform/queries": typeof domains_platform_queries;
  "domains/pricing/crons": typeof domains_pricing_crons;
  "domains/pricing/mutations": typeof domains_pricing_mutations;
  "domains/pricing/queries": typeof domains_pricing_queries;
  "domains/recipes/mutations": typeof domains_recipes_mutations;
  "domains/recipes/queries": typeof domains_recipes_queries;
  "domains/reports/queries": typeof domains_reports_queries;
  "domains/seed/mutations": typeof domains_seed_mutations;
  "domains/shifts/mutations": typeof domains_shifts_mutations;
  "domains/shifts/queries": typeof domains_shifts_queries;
  "domains/sizeScales/mutations": typeof domains_sizeScales_mutations;
  "domains/sizeScales/queries": typeof domains_sizeScales_queries;
  "domains/stock/internal": typeof domains_stock_internal;
  "domains/stock/master": typeof domains_stock_master;
  "domains/stock/mutations": typeof domains_stock_mutations;
  "domains/stock/queries": typeof domains_stock_queries;
  "domains/stockDocuments/access": typeof domains_stockDocuments_access;
  "domains/stockDocuments/mutations": typeof domains_stockDocuments_mutations;
  "domains/stockDocuments/queries": typeof domains_stockDocuments_queries;
  "domains/stockDocuments/validators": typeof domains_stockDocuments_validators;
  "domains/workforce/mutations": typeof domains_workforce_mutations;
  "domains/workforce/queries": typeof domains_workforce_queries;
  http: typeof http;
  "lib/accounts": typeof lib_accounts;
  "lib/audit": typeof lib_audit;
  "lib/auth": typeof lib_auth;
  "lib/availability": typeof lib_availability;
  "lib/capabilities": typeof lib_capabilities;
  "lib/domainRecords": typeof lib_domainRecords;
  "lib/finance": typeof lib_finance;
  "lib/ledger": typeof lib_ledger;
  "lib/lifecycles": typeof lib_lifecycles;
  "lib/loyalty": typeof lib_loyalty;
  "lib/modifierPricing": typeof lib_modifierPricing;
  "lib/money": typeof lib_money;
  "lib/numbering": typeof lib_numbering;
  "lib/officeAccess": typeof lib_officeAccess;
  "lib/outbox": typeof lib_outbox;
  "lib/periods": typeof lib_periods;
  "lib/policy": typeof lib_policy;
  "lib/pricing": typeof lib_pricing;
  "lib/recipeMath": typeof lib_recipeMath;
  "lib/recipes": typeof lib_recipes;
  "lib/restaurants": typeof lib_restaurants;
  "lib/stockAccounting": typeof lib_stockAccounting;
  "lib/stockPosting": typeof lib_stockPosting;
  "lib/systemRoles": typeof lib_systemRoles;
  "lib/time": typeof lib_time;
  "lib/validators": typeof lib_validators;
  "migrations/m3StockWarehouses": typeof migrations_m3StockWarehouses;
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
