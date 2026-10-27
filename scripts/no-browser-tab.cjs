// check:yg: @yandex-games/sdk-dev-proxy opens the game in the default browser on start
// (explorer.exe / open / xdg-open <url>) and has no flag against it. The check uses its own
// headless browser, so this preload turns that one call into a no-op.
// A CommonJS preload (node --require), so require() is the way to load here.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const cp = require('node:child_process');

const spawn = cp.spawn;
cp.spawn = function patched(cmd, args, ...rest) {
  const opener = /^(explorer\.exe|open|xdg-open)$/.test(String(cmd));
  if (opener && Array.isArray(args) && /localhost:\d+/.test(String(args[0]))) {
    return spawn.call(this, process.execPath, ['-e', ''], ...rest);
  }
  return spawn.call(this, cmd, args, ...rest);
};
