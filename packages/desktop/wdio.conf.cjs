const path = require("node:path");

const desktopRoot = __dirname;
const workspaceRoot = path.resolve(desktopRoot, "../..");

exports.config = {
  runner: "local",
  rootDir: desktopRoot,
  specs: ["./test/specs/**/*.e2e.ts"],
  maxInstances: 1,
  logLevel: "warn",
  bail: 0,
  waitforTimeout: 5000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 1,
  framework: "jasmine",
  reporters: ["spec"],
  services: [
    [
      "electron",
      {
        rootDir: workspaceRoot,
        apparmorAutoInstall: false,
      },
    ],
  ],
  jasmineOpts: {
    defaultTimeoutInterval: 30000,
  },
  capabilities: [
    {
      browserName: "electron",
      browserVersion: "42.3.0",
      "wdio:electronServiceOptions": {
        appEntryPoint: path.join(
          desktopRoot,
          ".vite",
          "build",
          "main.js",
        ),
        appArgs: ["--no-sandbox"],
      },
    },
  ],
};
