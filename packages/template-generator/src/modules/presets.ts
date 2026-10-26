import { MODULE_METADATA } from "../modules.generated";
import { readProductPresets } from "./metadata";

export const PRODUCT_PRESETS = readProductPresets(MODULE_METADATA);
