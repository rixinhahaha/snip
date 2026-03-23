const net = require('net');
const path = require('path');
const fs = require('fs');
const platform = require('./platform');

const MAX_BUFFER_SIZE = 16 * 1024 * 1024; // 16 MB per connection

let server = null;
let socketPath = null;

/**
 * Start a Unix domain socket server for MCP adapter communication.
 * @param {Object} handlers - Map of action names to async handler functions.
 */
function startSocketServer(handlers) {
  socketPath = platform.getSocketPath();

  // Ensure socket directory exists (needed on Linux where ~/.config/snip/ may not exist)
  try { fs.mkdirSync(path.dirname(socketPath), { recursive: true }); } catch {}

  // Remove stale socket file
  try { fs.unlinkSync(socketPath); } catch {}

  server = net.createServer(function (conn) {
    let buffer = '';

    conn.on('data', function (chunk) {
      buffer += chunk.toString();

      // Guard against unbounded buffer growth
      if (buffer.length > MAX_BUFFER_SIZE) {
        conn.destroy();
        buffer = '';
        return;
      }

      let newlineIdx;
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        var line = buffer.slice(0, newlineIdx).trim();
        buffer = buffer.slice(newlineIdx + 1);
        if (!line) continue;

        try {
          var msg = JSON.parse(line);
          handleMessage(conn, msg, handlers);
        } catch (err) {
          sendResponse(conn, null, null, 'Invalid JSON');
        }
      }
    });

    conn.on('error', function () {
      // Client disconnected — ignore
    });
  });

  server.on('error', function (err) {
    console.error('[SocketServer] Server error:', err.message);
  });

  server.listen(socketPath, function () {
    // Restrict socket to owner only (chmod 600)
    try { fs.chmodSync(socketPath, 0o600); } catch {}
    console.log('[SocketServer] Listening on %s', socketPath);
  });
}

async function handleMessage(conn, msg, handlers) {
  var id = msg.id != null ? msg.id : null;
  var action = msg.action;
  var params = msg.params || {};

  if (!action) {
    sendResponse(conn, id, null, 'Missing "action" field');
    return;
  }

  var handler = handlers[action];
  if (!handler) {
    sendResponse(conn, id, null, 'Unknown action: ' + action);
    return;
  }

  var source = msg.source || null;

  try {
    var result = await handler(params, source);
    sendResponse(conn, id, result, null);
  } catch (err) {
    sendResponse(conn, id, null, err.message || String(err));
  }
}

function sendResponse(conn, id, result, error) {
  var response = { id: id };
  if (error) {
    response.error = error;
  } else {
    response.result = result;
  }

  try {
    conn.write(JSON.stringify(response) + '\n');
  } catch {
    // Connection may have closed
  }
}

/**
 * Stop the socket server and clean up.
 */
function stopSocketServer() {
  if (server) {
    server.close();
    server = null;
  }
  if (socketPath) {
    try { fs.unlinkSync(socketPath); } catch {}
  }
}

module.exports = { startSocketServer, stopSocketServer };
