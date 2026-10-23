import type { ModuleManifest } from "../types";
import admin from "./admin";
import affiliate from "./affiliate";
import ai from "./ai";
import auth from "./auth";
import blog from "./blog";
import captcha from "./captcha";
import core from "./core";
import credits from "./credits";
import email from "./email";
import i18n from "./i18n";
import payment from "./payment";
import seo from "./seo";
import sms from "./sms";
import storage from "./storage";

export const MODULE_CATALOG: ReadonlyMap<string, ModuleManifest> = new Map(
  [
    core,
    i18n,
    auth,
    email,
    admin,
    payment,
    credits,
    sms,
    storage,
    ai,
    seo,
    blog,
    affiliate,
    captcha,
  ].map((module) => [module.id, module]),
);
