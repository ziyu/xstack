import type { ModuleManifest } from "../types";
import admin from "./admin";
import auth from "./auth";
import core from "./core";
import credits from "./credits";
import email from "./email";
import i18n from "./i18n";
import payment from "./payment";
import sms from "./sms";

export const MODULE_CATALOG: ReadonlyMap<string, ModuleManifest> = new Map(
  [core, i18n, auth, email, admin, payment, credits, sms].map((module) => [module.id, module]),
);
