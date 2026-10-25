// Share the generated-workspace lifecycle, ownership checks, and metadata resolution.
const child = Bun.spawn(
  [process.execPath, `${import.meta.dir}/c2.ts`, ...process.argv.slice(2), "--stage", "c3"],
  {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  },
);
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => child.kill(signal));
process.exitCode = await child.exited;
