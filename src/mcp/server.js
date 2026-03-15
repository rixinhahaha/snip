#!/usr/bin/env node

/**
 * Snip MCP Server — stdio transport.
 *
 * This is a thin adapter between the MCP protocol (JSON-RPC 2.0 over stdio)
 * and the running Snip Electron app (via Unix domain socket).
 *
 * Usage:
 *   node src/mcp/server.js
 *
 * MCP client config (Claude Desktop, etc.):
 *   {
 *     "mcpServers": {
 *       "snip": {
 *         "command": "node",
 *         "args": ["/path/to/snip/src/mcp/server.js"]
 *       }
 *     }
 *   }
 */

const net = require('net');
const path = require('path');
const os = require('os');

const SOCKET_PATH = path.join(
  os.homedir(), 'Library', 'Application Support', 'snip', 'snip.sock'
);

const PROTOCOL_VERSION = '2025-11-25';
const SERVER_NAME = 'snip';
const SERVER_VERSION = '1.0.0';

// ── MCP Tool Definitions ──

const TOOLS = [
  {
    name: 'search_screenshots',
    description: 'Search the user\'s saved screenshot library using a natural language query. Uses semantic embeddings for relevance ranking. Returns matching entries with category, name, description, tags, relevance score, and file path. Use get_screenshot to retrieve the actual image for a result.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural language search query (e.g. "login form", "error message", "chart")' }
      },
      required: ['query']
    }
  },
  {
    name: 'list_screenshots',
    description: 'List all saved screenshots with their metadata. Returns an array of index entries, each containing: category, name, description, tags, file path, and timestamp. Use get_screenshot with the file path to retrieve an actual image.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'get_screenshot',
    description: 'Retrieve a specific screenshot image by file path. Returns the image and its index metadata (category, name, description, tags). File path must be inside the screenshots directory (~/Documents/snip/screenshots/). Use list_screenshots or search_screenshots first to discover valid paths.',
    inputSchema: {
      type: 'object',
      properties: {
        filepath: { type: 'string', description: 'Absolute path to the screenshot file, as returned by list_screenshots or search_screenshots' }
      },
      required: ['filepath']
    }
  },
  {
    name: 'transcribe_screenshot',
    description: 'Extract text from a saved screenshot using OCR (macOS Vision framework). Returns recognized text and detected languages. Works best with screenshots containing readable text (code, documents, UI labels, error messages). File path must be inside the screenshots directory.',
    inputSchema: {
      type: 'object',
      properties: {
        filepath: { type: 'string', description: 'Absolute path to the screenshot file, as returned by list_screenshots or search_screenshots' }
      },
      required: ['filepath']
    }
  },
  {
    name: 'organize_screenshot',
    description: 'Queue a screenshot for AI categorization. A local vision LLM will analyze the image and assign a category, descriptive name, description, and tags. Processing happens in the background — this call returns immediately with a confirmation. The file must be inside the screenshots directory.',
    inputSchema: {
      type: 'object',
      properties: {
        filepath: { type: 'string', description: 'Absolute path to the screenshot file to categorize' }
      },
      required: ['filepath']
    }
  },
  {
    name: 'get_categories',
    description: 'List all screenshot categories available for organization. Returns both default categories (code, design, web, etc.) and any custom categories the user has added.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'open_in_snip',
    description: 'Open an image in Snip\'s annotation editor for the user to mark up. Pass the image as a local file path (preferred, works from CLI tools like Claude Code) or as a base64 data URL (works from any MCP client). The Snip editor window appears and this call blocks until the user clicks Done or Save, then returns the annotated image. Returns an error if the user cancels. PNG and JPEG supported, max 15 MB.',
    inputSchema: {
      type: 'object',
      properties: {
        imageDataURL: { type: 'string', description: 'Base64 data URL of the image (e.g. data:image/png;base64,iVBOR...). Use this from Claude Desktop or any sandboxed MCP client.' },
        filepath: { type: 'string', description: 'Absolute path to an image file on the local filesystem. Only works from CLI tools (e.g. Claude Code) that share the same filesystem as Snip.' }
      },
      required: []
    }
  },
  {
    name: 'install_extension',
    description: 'Install a new extension into Snip. Shows the user an approval dialog before installing. The extension runs in a sandboxed child process — it cannot access fs, child_process, net, http, or electron directly. Only action-tool and processor types are supported.\n\nHow to create an extension:\n1. Choose a name (alphanumeric + hyphens, e.g. "word-counter")\n2. Create a manifest object with: name, displayName, type ("action-tool" or "processor"), and an ipc array mapping channels to methods\n3. All IPC channels MUST use the "ext:" prefix (e.g. "ext:word-counter:count")\n4. Write mainCode that exports the methods referenced in the ipc array. Use module.exports = { methodName }.\n5. The mainCode runs in a sandbox: require("path"), require("crypto"), require("buffer") are allowed. require("fs"), require("child_process"), require("net"), etc. are blocked.\n6. For file access, declare permissions in the manifest: ["screenshots:read"] or ["temp:write"]. Use the context.api object passed to init(): context.api.readScreenshot(filepath), context.api.writeTemp(filename, data).\n\nExample:\n  name: "word-counter"\n  manifest: { name: "word-counter", displayName: "Word Counter", type: "action-tool", toolId: "word-counter", icon: "<svg .../>", tooltip: "Count Words", toolbarPosition: 11, ipc: [{ channel: "ext:word-counter:count", method: "count" }] }\n  mainCode: "async function count(event, { text }) { return { words: text.split(/\\\\s+/).length }; }\\nmodule.exports = { count };"',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Extension name (alphanumeric + hyphens only, e.g. "word-counter")' },
        manifest: {
          type: 'object',
          description: 'The extension.json manifest. Required fields: name (string), displayName (string), type ("action-tool" or "processor"). Optional: ipc (array of {channel, method}), permissions (array of "screenshots:read", "temp:write", "network"), toolId, icon (SVG string), tooltip, shortcut, toolbarPosition (number).'
        },
        mainCode: { type: 'string', description: 'JavaScript source code for main.js. Must use module.exports to export functions referenced by the ipc array. Runs in a sandboxed process. init(context) is called on load — context.api provides readScreenshot() and writeTemp() if permissions are declared.' }
      },
      required: ['name', 'manifest']
    }
  }
];

// ── Socket Connection ──

let snipConn = null;
let pendingRequests = {};
let requestCounter = 0;

function connectToSnip() {
  return new Promise(function (resolve, reject) {
    var conn = net.createConnection(SOCKET_PATH);
    var buffer = '';

    conn.on('connect', function () {
      snipConn = conn;
      resolve(conn);
    });

    conn.on('data', function (chunk) {
      buffer += chunk.toString();
      var newlineIdx;
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        var line = buffer.slice(0, newlineIdx).trim();
        buffer = buffer.slice(newlineIdx + 1);
        if (!line) continue;

        try {
          var response = JSON.parse(line);
          var pending = pendingRequests[response.id];
          if (pending) {
            delete pendingRequests[response.id];
            if (response.error) {
              pending.reject(new Error(response.error));
            } else {
              pending.resolve(response.result);
            }
          }
        } catch {}
      }
    });

    conn.on('error', function (err) {
      snipConn = null;
      reject(new Error('Cannot connect to Snip app. Is it running? (' + err.message + ')'));
    });

    conn.on('close', function () {
      snipConn = null;
      // Reject all pending requests
      Object.keys(pendingRequests).forEach(function (id) {
        pendingRequests[id].reject(new Error('Connection to Snip closed'));
        delete pendingRequests[id];
      });
    });
  });
}

function callSnip(action, params) {
  return new Promise(function (resolve, reject) {
    if (!snipConn) {
      reject(new Error('Not connected to Snip app'));
      return;
    }

    var id = 'mcp-' + (++requestCounter);
    pendingRequests[id] = { resolve: resolve, reject: reject };

    var msg = JSON.stringify({ id: id, action: action, params: params || {} }) + '\n';
    snipConn.write(msg);
  });
}

// ── MCP Protocol Handler ──

var useFramedOutput = false; // set by auto-detect in transport

function sendJsonRpc(obj) {
  var json = JSON.stringify(obj);
  if (useFramedOutput) {
    var header = 'Content-Length: ' + Buffer.byteLength(json) + '\r\n\r\n';
    process.stdout.write(header + json);
  } else {
    process.stdout.write(json + '\n');
  }
}

function sendResult(id, result) {
  sendJsonRpc({ jsonrpc: '2.0', id: id, result: result });
}

function sendError(id, code, message) {
  sendJsonRpc({ jsonrpc: '2.0', id: id, error: { code: code, message: message } });
}

async function handleRequest(msg) {
  var id = msg.id;
  var method = msg.method;

  switch (method) {
    case 'initialize':
      sendResult(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION }
      });
      break;

    case 'notifications/initialized':
      // No-op — client is ready
      break;

    case 'tools/list':
      sendResult(id, { tools: TOOLS });
      break;

    case 'tools/call':
      await handleToolCall(id, msg.params);
      break;

    case 'ping':
      sendResult(id, {});
      break;

    default:
      if (id !== undefined) {
        sendError(id, -32601, 'Method not found: ' + method);
      }
  }
}

async function handleToolCall(id, params) {
  var toolName = params.name;
  var args = params.arguments || {};

  try {
    // Ensure connection to Snip app
    if (!snipConn) {
      await connectToSnip();
    }

    var result = await callSnip(toolName, args);

    // Format result as MCP content
    var content;
    if (result && result.dataURL) {
      // Image result — return as image content
      var match = result.dataURL.match(/^data:(image\/\w+);base64,(.+)$/);
      if (match) {
        content = [
          { type: 'image', data: match[2], mimeType: match[1] },
          { type: 'text', text: JSON.stringify({ width: result.width, height: result.height }, null, 2) }
        ];
      } else {
        content = [{ type: 'text', text: JSON.stringify(result, null, 2) }];
      }
    } else {
      content = [{ type: 'text', text: JSON.stringify(result, null, 2) }];
    }

    sendResult(id, { content: content });
  } catch (err) {
    sendResult(id, {
      content: [{ type: 'text', text: 'Error: ' + err.message }],
      isError: true
    });
  }
}

// ── Stdio Transport ──

function startStdioTransport() {
  let buffer = '';
  let contentLength = null;
  let framed = null; // null = auto-detect, true = Content-Length framing, false = newline-delimited

  function processMessage(body) {
    try {
      var msg = JSON.parse(body);
      handleRequest(msg).catch(function (err) {
        if (msg.id !== undefined) {
          sendError(msg.id, -32603, err.message);
        }
      });
    } catch (err) {
      // Invalid JSON — skip
    }
  }

  function processFramed() {
    while (buffer.length > 0) {
      if (contentLength === null) {
        // Look for header separator (accept \r\n\r\n and \n\n)
        var headerEnd = buffer.indexOf('\r\n\r\n');
        var sepLen = 4;
        if (headerEnd === -1) {
          headerEnd = buffer.indexOf('\n\n');
          sepLen = 2;
        }
        if (headerEnd === -1) return;

        var header = buffer.slice(0, headerEnd);
        var match = header.match(/Content-Length:\s*(\d+)/i);
        if (!match) {
          buffer = buffer.slice(headerEnd + sepLen);
          continue;
        }
        contentLength = parseInt(match[1]);
        if (contentLength > 10 * 1024 * 1024) {
          buffer = buffer.slice(headerEnd + sepLen);
          contentLength = null;
          continue;
        }
        buffer = buffer.slice(headerEnd + sepLen);
      }

      if (buffer.length < contentLength) return;

      var body = buffer.slice(0, contentLength);
      buffer = buffer.slice(contentLength);
      contentLength = null;
      processMessage(body);
    }
  }

  function processLines() {
    var newlineIdx;
    while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
      var line = buffer.slice(0, newlineIdx).trim();
      buffer = buffer.slice(newlineIdx + 1);
      if (!line) continue;
      processMessage(line);
    }
  }

  process.stdin.on('data', function (chunk) {
    buffer += chunk.toString();

    // Guard against unbounded buffer growth
    if (buffer.length > 16 * 1024 * 1024) {
      buffer = '';
      return;
    }

    // Auto-detect framing on first data
    if (framed === null) {
      var trimmed = buffer.trimStart();
      if (trimmed.startsWith('{')) {
        framed = false; // newline-delimited JSON
        useFramedOutput = false;
      } else {
        framed = true; // Content-Length framed
        useFramedOutput = true;
      }
    }

    if (framed) {
      processFramed();
    } else {
      processLines();
    }
  });

  process.stdin.on('end', function () {
    process.exit(0);
  });
}

// ── Main ──

startStdioTransport();
