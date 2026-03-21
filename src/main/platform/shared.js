/**
 * Shared platform utilities — functions that are identical across
 * darwin and linux (POSIX). Win32 overrides where needed.
 */

var net = require('net');
var path = require('path');
var os = require('os');

// ── Process management (POSIX) ──

function killProcess(proc) {
  return new Promise(function (resolve) {
    if (!proc) return resolve();

    try { proc.kill('SIGTERM'); } catch (_) {}

    var timeout = setTimeout(function () {
      if (proc) {
        try {
          proc.kill('SIGKILL');
        } catch (_) {}
      }
      resolve();
    }, 3000);

    proc.on('exit', function () {
      clearTimeout(timeout);
      resolve();
    });
  });
}

// ── Socket polling ──

function pollForSocket(socketPath, callback) {
  var attempts = 0;
  function check() {
    attempts++;
    if (attempts > 20) {
      return callback(new Error('Snip did not start in time'));
    }
    var conn = net.createConnection(socketPath);
    conn.on('connect', function () {
      conn.end();
      callback(null);
    });
    conn.on('error', function () {
      conn.destroy();
      setTimeout(check, 500);
    });
  }
  setTimeout(check, 500);
}

// ── CLI install (POSIX) ──

function getCliInstallPaths() {
  var home = os.homedir();
  return [
    '/usr/local/bin/snip',
    path.join(home, '.local', 'bin', 'snip'),
    path.join(home, 'bin', 'snip')
  ];
}

function getCliWrapperContent(nodePath, cliPath) {
  var safeNode = nodePath.replace(/'/g, "'\\''");
  var safeCli = cliPath.replace(/'/g, "'\\''");
  return "#!/bin/sh\n# Snip CLI — installed by Snip.app\nexec '" + safeNode + "' '" + safeCli + "' \"$@\"\n";
}

module.exports = {
  killProcess,
  pollForSocket,
  getCliInstallPaths,
  getCliWrapperContent
};
