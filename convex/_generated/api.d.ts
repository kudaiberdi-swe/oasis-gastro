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
import type * as domains_corporation_departments from "../domains/corporation/departments.js";
import type * as domains_corporation_organizations from "../domains/corporation/organizations.js";
import type * as domains_corporation_restaurants from "../domains/corporation/restaurants.js";
import type * as domains_delivery_internal from "../domains/delivery/internal.js";
import type * as domains_delivery_mutations from "../domains/delivery/mutations.js";
import type * as domains_delivery_queries from "../domains/delivery/queries.js";
import type * as domains_delivery_shared from "../domains/delivery/shared.js";
import type * as domains_finance_modules from "../domains/finance/modules.js";
import type * as domains_finance_mutations from "../domains/finance/mutations.js";
import type * as domains_finance_obligations from "../domains/finance/obligations.js";
import type * as domains_finance_queries from "../domains/finance/queries.js";
import type * as domains_finance_records from "../domains/finance/records.js";
import type * as domains_finance_seed from "../domains/finance/seed.js";
import type * as domains_finance_shiftAcceptance from "../domains/finance/shiftAcceptance.js";
import type * as domains_finance_validators from "../domains/finance/validators.js";
import type * as domains_iiko_catalog from "../domains/iiko/catalog.js";
import type * as domains_iiko_internal from "../domains/iiko/internal.js";
import type * as domains_iiko_mutations from "../domains/iiko/mutations.js";
import type * as domains_iiko_office from "../domains/iiko/office.js";
import type * as domains_iiko_operations from "../domains/iiko/operations.js";
import type * as domains_iiko_projections from "../domains/iiko/projections.js";
import type * as domains_integrations_adapters_email from "../domains/integrations/adapters/email.js";
import type * as domains_integrations_internal from "../domains/integrations/internal.js";
import type * as domains_integrations_mutations from "../domains/integrations/mutations.js";
import type * as domains_integrations_queries from "../domains/integrations/queries.js";
import type * as domains_integrations_validators from "../domains/integrations/validators.js";
import type * as domains_kitchen_access from "../domains/kitchen/access.js";
import type * as domains_kitchen_mutations from "../domains/kitchen/mutations.js";
import type * as domains_kitchen_queries from "../domains/kitchen/queries.js";
import type * as domains_loyalty_expiry from "../domains/loyalty/expiry.js";
import type * as domains_loyalty_mutations from "../domains/loyalty/mutations.js";
import type * as domains_loyalty_office from "../domains/loyalty/office.js";
import type * as domains_loyalty_queries from "../domains/loyalty/queries.js";
import type * as domains_loyalty_reservations from "../domains/loyalty/reservations.js";
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
import type * as domains_pos_internal from "../domains/pos/internal.js";
import type * as domains_pos_mutations from "../domains/pos/mutations.js";
import type * as domains_pos_queries from "../domains/pos/queries.js";
import type * as domains_pricing_crons from "../domains/pricing/crons.js";
import type * as domains_pricing_mutations from "../domains/pricing/mutations.js";
import type * as domains_pricing_queries from "../domains/pricing/queries.js";
import type * as domains_production_documents from "../domains/production/documents.js";
import type * as domains_production_preparations from "../domains/production/preparations.js";
import type * as domains_purchasing_receipts from "../domains/purchasing/receipts.js";
import type * as domains_recipes_mutations from "../domains/recipes/mutations.js";
import type * as domains_recipes_queries from "../domains/recipes/queries.js";
import type * as domains_recipes_seed from "../domains/recipes/seed.js";
import type * as domains_reports_calculators__facts from "../domains/reports/calculators/_facts.js";
import type * as domains_reports_calculators__scope from "../domains/reports/calculators/_scope.js";
import type * as domains_reports_calculators__shared from "../domains/reports/calculators/_shared.js";
import type * as domains_reports_calculators_employees from "../domains/reports/calculators/employees.js";
import type * as domains_reports_calculators_finance from "../domains/reports/calculators/finance.js";
import type * as domains_reports_calculators_loyalty from "../domains/reports/calculators/loyalty.js";
import type * as domains_reports_calculators_menu from "../domains/reports/calculators/menu.js";
import type * as domains_reports_calculators_operations from "../domains/reports/calculators/operations.js";
import type * as domains_reports_calculators_sales from "../domains/reports/calculators/sales.js";
import type * as domains_reports_calculators_stock from "../domains/reports/calculators/stock.js";
import type * as domains_reports_calculators_stockHelpers from "../domains/reports/calculators/stockHelpers.js";
import type * as domains_reports_calculators_stockW2 from "../domains/reports/calculators/stockW2.js";
import type * as domains_reports_catalog from "../domains/reports/catalog.js";
import type * as domains_reports_internal from "../domains/reports/internal.js";
import type * as domains_reports_mutations from "../domains/reports/mutations.js";
import type * as domains_reports_queries from "../domains/reports/queries.js";
import type * as domains_reports_registry from "../domains/reports/registry.js";
import type * as domains_reports_schedules from "../domains/reports/schedules.js";
import type * as domains_retail_internal from "../domains/retail/internal.js";
import type * as domains_retail_mutations from "../domains/retail/mutations.js";
import type * as domains_retail_office from "../domains/retail/office.js";
import type * as domains_retail_queries from "../domains/retail/queries.js";
import type * as domains_retail_validators from "../domains/retail/validators.js";
import type * as domains_seed_mutations from "../domains/seed/mutations.js";
import type * as domains_shifts_mutations from "../domains/shifts/mutations.js";
import type * as domains_shifts_queries from "../domains/shifts/queries.js";
import type * as domains_sizeScales_mutations from "../domains/sizeScales/mutations.js";
import type * as domains_sizeScales_queries from "../domains/sizeScales/queries.js";
import type * as domains_stock_internal from "../domains/stock/internal.js";
import type * as domains_stock_master from "../domains/stock/master.js";
import type * as domains_stock_priceLists from "../domains/stock/priceLists.js";
import type * as domains_stockDocuments_access from "../domains/stockDocuments/access.js";
import type * as domains_stockDocuments_mutations from "../domains/stockDocuments/mutations.js";
import type * as domains_stockDocuments_queries from "../domains/stockDocuments/queries.js";
import type * as domains_stockDocuments_validators from "../domains/stockDocuments/validators.js";
import type * as domains_workforce_attendance from "../domains/workforce/attendance.js";
import type * as domains_workforce_mutations from "../domains/workforce/mutations.js";
import type * as domains_workforce_payroll from "../domains/workforce/payroll.js";
import type * as domains_workforce_queries from "../domains/workforce/queries.js";
import type * as domains_workforce_references from "../domains/workforce/references.js";
import type * as domains_workforce_schedule from "../domains/workforce/schedule.js";
import type * as http from "../http.js";
import type * as lib_accounts from "../lib/accounts.js";
import type * as lib_attendance from "../lib/attendance.js";
import type * as lib_audit from "../lib/audit.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_availability from "../lib/availability.js";
import type * as lib_bin from "../lib/bin.js";
import type * as lib_capabilities from "../lib/capabilities.js";
import type * as lib_checkoutCore from "../lib/checkoutCore.js";
import type * as lib_deliveryCore from "../lib/deliveryCore.js";
import type * as lib_domainRecords from "../lib/domainRecords.js";
import type * as lib_finance from "../lib/finance.js";
import type * as lib_kitchen from "../lib/kitchen.js";
import type * as lib_ledger from "../lib/ledger.js";
import type * as lib_lifecycles from "../lib/lifecycles.js";
import type * as lib_loyalty from "../lib/loyalty.js";
import type * as lib_loyaltyCore from "../lib/loyaltyCore.js";
import type * as lib_modifierPricing from "../lib/modifierPricing.js";
import type * as lib_money from "../lib/money.js";
import type * as lib_numbering from "../lib/numbering.js";
import type * as lib_obligations from "../lib/obligations.js";
import type * as lib_officeAccess from "../lib/officeAccess.js";
import type * as lib_orderPricing from "../lib/orderPricing.js";
import type * as lib_outbox from "../lib/outbox.js";
import type * as lib_payroll from "../lib/payroll.js";
import type * as lib_periods from "../lib/periods.js";
import type * as lib_pii from "../lib/pii.js";
import type * as lib_policy from "../lib/policy.js";
import type * as lib_priceChecks from "../lib/priceChecks.js";
import type * as lib_priceListCheck from "../lib/priceListCheck.js";
import type * as lib_pricing from "../lib/pricing.js";
import type * as lib_recipeConsumption from "../lib/recipeConsumption.js";
import type * as lib_recipeMath from "../lib/recipeMath.js";
import type * as lib_recipes from "../lib/recipes.js";
import type * as lib_reportConfig from "../lib/reportConfig.js";
import type * as lib_reportExport from "../lib/reportExport.js";
import type * as lib_reportFacts from "../lib/reportFacts.js";
import type * as lib_reportSchedule from "../lib/reportSchedule.js";
import type * as lib_restaurants from "../lib/restaurants.js";
import type * as lib_retailSettings from "../lib/retailSettings.js";
import type * as lib_stockAccounting from "../lib/stockAccounting.js";
import type * as lib_stockFacts from "../lib/stockFacts.js";
import type * as lib_stockPosting from "../lib/stockPosting.js";
import type * as lib_systemRoles from "../lib/systemRoles.js";
import type * as lib_time from "../lib/time.js";
import type * as lib_validators from "../lib/validators.js";
import type * as migrations_m2Orders from "../migrations/m2Orders.js";
import type * as migrations_m3StockWarehouses from "../migrations/m3StockWarehouses.js";
import type * as migrations_m4LedgerToJournal from "../migrations/m4LedgerToJournal.js";
import type * as migrations_m5Loyalty from "../migrations/m5Loyalty.js";
import type * as migrations_m7KitchenTickets from "../migrations/m7KitchenTickets.js";
import type * as migrations_m9DailyStockFacts from "../migrations/m9DailyStockFacts.js";

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
  "domains/corporation/departments": typeof domains_corporation_departments;
  "domains/corporation/organizations": typeof domains_corporation_organizations;
  "domains/corporation/restaurants": typeof domains_corporation_restaurants;
  "domains/delivery/internal": typeof domains_delivery_internal;
  "domains/delivery/mutations": typeof domains_delivery_mutations;
  "domains/delivery/queries": typeof domains_delivery_queries;
  "domains/delivery/shared": typeof domains_delivery_shared;
  "domains/finance/modules": typeof domains_finance_modules;
  "domains/finance/mutations": typeof domains_finance_mutations;
  "domains/finance/obligations": typeof domains_finance_obligations;
  "domains/finance/queries": typeof domains_finance_queries;
  "domains/finance/records": typeof domains_finance_records;
  "domains/finance/seed": typeof domains_finance_seed;
  "domains/finance/shiftAcceptance": typeof domains_finance_shiftAcceptance;
  "domains/finance/validators": typeof domains_finance_validators;
  "domains/iiko/catalog": typeof domains_iiko_catalog;
  "domains/iiko/internal": typeof domains_iiko_internal;
  "domains/iiko/mutations": typeof domains_iiko_mutations;
  "domains/iiko/office": typeof domains_iiko_office;
  "domains/iiko/operations": typeof domains_iiko_operations;
  "domains/iiko/projections": typeof domains_iiko_projections;
  "domains/integrations/adapters/email": typeof domains_integrations_adapters_email;
  "domains/integrations/internal": typeof domains_integrations_internal;
  "domains/integrations/mutations": typeof domains_integrations_mutations;
  "domains/integrations/queries": typeof domains_integrations_queries;
  "domains/integrations/validators": typeof domains_integrations_validators;
  "domains/kitchen/access": typeof domains_kitchen_access;
  "domains/kitchen/mutations": typeof domains_kitchen_mutations;
  "domains/kitchen/queries": typeof domains_kitchen_queries;
  "domains/loyalty/expiry": typeof domains_loyalty_expiry;
  "domains/loyalty/mutations": typeof domains_loyalty_mutations;
  "domains/loyalty/office": typeof domains_loyalty_office;
  "domains/loyalty/queries": typeof domains_loyalty_queries;
  "domains/loyalty/reservations": typeof domains_loyalty_reservations;
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
  "domains/pos/internal": typeof domains_pos_internal;
  "domains/pos/mutations": typeof domains_pos_mutations;
  "domains/pos/queries": typeof domains_pos_queries;
  "domains/pricing/crons": typeof domains_pricing_crons;
  "domains/pricing/mutations": typeof domains_pricing_mutations;
  "domains/pricing/queries": typeof domains_pricing_queries;
  "domains/production/documents": typeof domains_production_documents;
  "domains/production/preparations": typeof domains_production_preparations;
  "domains/purchasing/receipts": typeof domains_purchasing_receipts;
  "domains/recipes/mutations": typeof domains_recipes_mutations;
  "domains/recipes/queries": typeof domains_recipes_queries;
  "domains/recipes/seed": typeof domains_recipes_seed;
  "domains/reports/calculators/_facts": typeof domains_reports_calculators__facts;
  "domains/reports/calculators/_scope": typeof domains_reports_calculators__scope;
  "domains/reports/calculators/_shared": typeof domains_reports_calculators__shared;
  "domains/reports/calculators/employees": typeof domains_reports_calculators_employees;
  "domains/reports/calculators/finance": typeof domains_reports_calculators_finance;
  "domains/reports/calculators/loyalty": typeof domains_reports_calculators_loyalty;
  "domains/reports/calculators/menu": typeof domains_reports_calculators_menu;
  "domains/reports/calculators/operations": typeof domains_reports_calculators_operations;
  "domains/reports/calculators/sales": typeof domains_reports_calculators_sales;
  "domains/reports/calculators/stock": typeof domains_reports_calculators_stock;
  "domains/reports/calculators/stockHelpers": typeof domains_reports_calculators_stockHelpers;
  "domains/reports/calculators/stockW2": typeof domains_reports_calculators_stockW2;
  "domains/reports/catalog": typeof domains_reports_catalog;
  "domains/reports/internal": typeof domains_reports_internal;
  "domains/reports/mutations": typeof domains_reports_mutations;
  "domains/reports/queries": typeof domains_reports_queries;
  "domains/reports/registry": typeof domains_reports_registry;
  "domains/reports/schedules": typeof domains_reports_schedules;
  "domains/retail/internal": typeof domains_retail_internal;
  "domains/retail/mutations": typeof domains_retail_mutations;
  "domains/retail/office": typeof domains_retail_office;
  "domains/retail/queries": typeof domains_retail_queries;
  "domains/retail/validators": typeof domains_retail_validators;
  "domains/seed/mutations": typeof domains_seed_mutations;
  "domains/shifts/mutations": typeof domains_shifts_mutations;
  "domains/shifts/queries": typeof domains_shifts_queries;
  "domains/sizeScales/mutations": typeof domains_sizeScales_mutations;
  "domains/sizeScales/queries": typeof domains_sizeScales_queries;
  "domains/stock/internal": typeof domains_stock_internal;
  "domains/stock/master": typeof domains_stock_master;
  "domains/stock/priceLists": typeof domains_stock_priceLists;
  "domains/stockDocuments/access": typeof domains_stockDocuments_access;
  "domains/stockDocuments/mutations": typeof domains_stockDocuments_mutations;
  "domains/stockDocuments/queries": typeof domains_stockDocuments_queries;
  "domains/stockDocuments/validators": typeof domains_stockDocuments_validators;
  "domains/workforce/attendance": typeof domains_workforce_attendance;
  "domains/workforce/mutations": typeof domains_workforce_mutations;
  "domains/workforce/payroll": typeof domains_workforce_payroll;
  "domains/workforce/queries": typeof domains_workforce_queries;
  "domains/workforce/references": typeof domains_workforce_references;
  "domains/workforce/schedule": typeof domains_workforce_schedule;
  http: typeof http;
  "lib/accounts": typeof lib_accounts;
  "lib/attendance": typeof lib_attendance;
  "lib/audit": typeof lib_audit;
  "lib/auth": typeof lib_auth;
  "lib/availability": typeof lib_availability;
  "lib/bin": typeof lib_bin;
  "lib/capabilities": typeof lib_capabilities;
  "lib/checkoutCore": typeof lib_checkoutCore;
  "lib/deliveryCore": typeof lib_deliveryCore;
  "lib/domainRecords": typeof lib_domainRecords;
  "lib/finance": typeof lib_finance;
  "lib/kitchen": typeof lib_kitchen;
  "lib/ledger": typeof lib_ledger;
  "lib/lifecycles": typeof lib_lifecycles;
  "lib/loyalty": typeof lib_loyalty;
  "lib/loyaltyCore": typeof lib_loyaltyCore;
  "lib/modifierPricing": typeof lib_modifierPricing;
  "lib/money": typeof lib_money;
  "lib/numbering": typeof lib_numbering;
  "lib/obligations": typeof lib_obligations;
  "lib/officeAccess": typeof lib_officeAccess;
  "lib/orderPricing": typeof lib_orderPricing;
  "lib/outbox": typeof lib_outbox;
  "lib/payroll": typeof lib_payroll;
  "lib/periods": typeof lib_periods;
  "lib/pii": typeof lib_pii;
  "lib/policy": typeof lib_policy;
  "lib/priceChecks": typeof lib_priceChecks;
  "lib/priceListCheck": typeof lib_priceListCheck;
  "lib/pricing": typeof lib_pricing;
  "lib/recipeConsumption": typeof lib_recipeConsumption;
  "lib/recipeMath": typeof lib_recipeMath;
  "lib/recipes": typeof lib_recipes;
  "lib/reportConfig": typeof lib_reportConfig;
  "lib/reportExport": typeof lib_reportExport;
  "lib/reportFacts": typeof lib_reportFacts;
  "lib/reportSchedule": typeof lib_reportSchedule;
  "lib/restaurants": typeof lib_restaurants;
  "lib/retailSettings": typeof lib_retailSettings;
  "lib/stockAccounting": typeof lib_stockAccounting;
  "lib/stockFacts": typeof lib_stockFacts;
  "lib/stockPosting": typeof lib_stockPosting;
  "lib/systemRoles": typeof lib_systemRoles;
  "lib/time": typeof lib_time;
  "lib/validators": typeof lib_validators;
  "migrations/m2Orders": typeof migrations_m2Orders;
  "migrations/m3StockWarehouses": typeof migrations_m3StockWarehouses;
  "migrations/m4LedgerToJournal": typeof migrations_m4LedgerToJournal;
  "migrations/m5Loyalty": typeof migrations_m5Loyalty;
  "migrations/m7KitchenTickets": typeof migrations_m7KitchenTickets;
  "migrations/m9DailyStockFacts": typeof migrations_m9DailyStockFacts;
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
