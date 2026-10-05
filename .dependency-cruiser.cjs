/**
 * Dependency fences for the Taco Bell kiosk shell.
 * The @cx-sdk packages carry their own fences in the SDK repo
 * (posistKiosk-cx-sdk/.dependency-cruiser.cjs); this file only guards the shell.
 * Wired into `yarn validate` AND CI — keep it that way.
 */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment:
        "This is a fresh codebase — cycles are fatal, no legacy ratchet here.",
      from: {},
      to: { circular: true },
    },
    {
      name: "no-sibling-repo-relative",
      severity: "error",
      comment:
        "SDK code must be imported as @cx-sdk/<pkg>/..., never by relative path into the sibling repo.",
      from: { path: "^src" },
      to: { path: "posistKiosk-cx-sdk" },
    },
    {
      name: "no-orphans",
      severity: "warn",
      comment: "Flag dead files early instead of accumulating them.",
      from: {
        orphan: true,
        pathNot: ["\\.d\\.ts$", "src/main\\.tsx$", "src/setupTests\\.ts$"],
      },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.app.json" },
    exclude: "\\.(test|spec)\\.[jt]sx?$|__tests__|/dev-dist/|/coverage/",
  },
};
