import { MODULE_METADATA } from "../../modules.generated";
import { readModuleCatalog } from "../metadata";

export { readModuleCatalog } from "../metadata";

export const MODULE_CATALOG = readModuleCatalog(MODULE_METADATA);
