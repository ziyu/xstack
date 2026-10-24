import { inventoryContributions, contributionMatrix } from "../src/contributions/inventory";
import { loadTemplates } from "../src/core/template-reader";

const inventory = inventoryContributions(await loadTemplates());
console.log(
  JSON.stringify(
    {
      sources: inventory.entries.length,
      issues: inventory.issues,
      matrix: contributionMatrix(inventory),
      entries: process.argv.includes("--sources") ? inventory.entries : undefined,
    },
    null,
    2,
  ),
);
if (inventory.issues.length) process.exitCode = 1;
