/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as accounts from "../accounts.js";
import type * as boxes from "../boxes.js";
import type * as crons from "../crons.js";
import type * as demo from "../demo.js";
import type * as files from "../files.js";
import type * as http from "../http.js";
import type * as interactions from "../interactions.js";
import type * as lib from "../lib.js";
import type * as limits from "../limits.js";
import type * as links from "../links.js";
import type * as media from "../media.js";
import type * as mediaPolicy from "../mediaPolicy.js";
import type * as moderation from "../moderation.js";
import type * as notify from "../notify.js";
import type * as retention from "../retention.js";
import type * as seed from "../seed.js";
import type * as stats from "../stats.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  accounts: typeof accounts;
  boxes: typeof boxes;
  crons: typeof crons;
  demo: typeof demo;
  files: typeof files;
  http: typeof http;
  interactions: typeof interactions;
  lib: typeof lib;
  limits: typeof limits;
  links: typeof links;
  media: typeof media;
  mediaPolicy: typeof mediaPolicy;
  moderation: typeof moderation;
  notify: typeof notify;
  retention: typeof retention;
  seed: typeof seed;
  stats: typeof stats;
  users: typeof users;
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
