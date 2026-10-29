// Keep generation, install/check/build, ownership, reports and cleanup in the C2 lifecycle.
const child = Bun.spawn(
  [process.execPath, `${import.meta.dir}/c2.ts`, ...process.argv.slice(2), "--stage", "c4"],
  { stdin: "inherit", stdout: "inherit", stderr: "inherit" },
);
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => child.kill(signal));
process.exitCode = await child.exited;
