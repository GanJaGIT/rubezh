/// <reference types="vite/client" />

/** BLD-04: version from package.json, injected by Vite. */
declare const __APP_VERSION__: string;

/** package.json name: the save key and the archive name. */
declare const __APP_ID__: string;

/** DEV-02: true in dev and e2e builds, false in the release build. */
declare const __DEV_HOOKS__: boolean;
