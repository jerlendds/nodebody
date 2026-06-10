import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { MakerDeb } from "@electron-forge/maker-deb";
import { MakerRpm } from "@electron-forge/maker-rpm";
import { VitePlugin } from "@electron-forge/plugin-vite";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { FuseV1Options, FuseVersion } from "@electron/fuses";
// import { MakerDMG } from "@electron-forge/maker-dmg";
// import { MakerPKG } from "@electron-forge/maker-pkg";
import MakerAppImage from "electron-forge-maker-appimage";
import { ElectronegativityPlugin } from "@electron-forge/plugin-electronegativity";
import { MakerMSIX } from "@electron-forge/maker-msix";
import { PublisherGithub } from "@electron-forge/publisher-github";

const makers: ForgeConfig["makers"] = [
  new MakerSquirrel({}),
  new MakerZIP({}, ["darwin", "linux", "windows"]),
  new MakerDeb({}),
  // TODO: Fix `FAILED: No identity found for signing.` error in github actions workflow
  // new MakerDMG(
  //   {
  //     title: "InterfaceZ",
  //     icon: "./src/assets/images/logo.png",
  //     background: "./src/assets/images/dmg-background.png",
  //     format: "ULFO",
  //   },
  //   ["darwin"],
  // ),
  // new MakerPKG(
  //   {
  //     name: "InterfaceZ",
  //   },
  //   ["darwin"],
  // ),
  new MakerMSIX({
    manifestVariables: {
      publisher: "CN=interfacez",
      packageIdentity: "ai.interfacez",
      appExecutable: "interfacez.exe",
      appDisplayName: "InterfaceZ",
    },
    windowsSignOptions: {
      certificateFile: process.env.WINDOWS_CERTIFICATE_FILE,
      certificatePassword: process.env.WINDOWS_CERTIFICATE_PASSWORD,
      website: "https://interfacez.ai",
      description:
        "InterfaceZ was built for everybody, because nobody should be lost in the code.",
    },
  }),
  new MakerAppImage(
    {
      options: {
        homepage: "https://interfacez.ai",
        description:
          "InterfaceZ was built for everybody, because nobody should be lost in the code.",
        icon: "./src/assets/images/logo.png",
        maintainer: "jerlendds <jerlendds@interfacez.ai>",
        name: "interfacez",
        productDescription:
          "InterfaceZ was built for everybody, because nobody should be lost in the code.",
        productName: "InterfaceZ",
      },
    },
    ["linux"],
  ),
];

if (process.env.ENABLE_RPM === "true") {
  makers.push(
    new MakerRpm(
      {
        options: {
          homepage: "https://interfacez.ai",
          icon: "./src/assets/images/logo.png",
          license: "UNLICENSED",
        },
      },
      ["linux"],
    ),
  );
}

const config: ForgeConfig = {
  packagerConfig: {
    name: "InterfaceZ",
    asar: true,
    prune: true,
    executableName: "interfacez",
    appCopyright: "jerlendds <jerlendds@interfacez.ai>",
    icon: "./src/assets/images/logo",
  },
  rebuildConfig: {},
  makers,
  publishers: [
    new PublisherGithub({
      repository: {
        owner: "jerlendds",
        name: "interfacez",
      },
      draft: true,
      force: true,
      generateReleaseNotes: true,
    }),
  ],
  plugins: [
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: "src/main.ts",
          config: "vite.main.config.ts",
          target: "main",
        },
        {
          entry: "src/preload.ts",
          config: "vite.preload.config.ts",
          target: "preload",
        },
      ],
      renderer: [
        {
          name: "main_window",
          config: "vite.renderer.config.ts",
        },
      ],
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
    new ElectronegativityPlugin({
      isSarif: true,
    }),
  ],
};

export default config;
