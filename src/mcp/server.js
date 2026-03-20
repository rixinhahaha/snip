#!/usr/bin/env node

/**
 * Snip MCP Server — stdio transport.
 *
 * Thin adapter between MCP protocol (JSON-RPC 2.0 over stdio)
 * and the Snip CLI. All tool calls spawn `snip <command>` and
 * read stdout. No direct socket management.
 *
 * Usage:
 *   node src/mcp/server.js
 */

var path = require('path');
var { execFile } = require('child_process');

// Resolve CLI path and Node binary
var CLI_PATH;
var NODE_PATH;

// In packaged app: CLI is in Resources/cli/, Node is in Resources/node/
// In dev: CLI is at src/cli/snip.js, use system node
var isPackaged = false;
try { isPackaged = require('fs').existsSync(path.join(__dirname, '..', '..', 'app.asar')); } catch {}

var { findNodeBinary } = require('../main/node-binary');

if (isPackaged || __dirname.includes('app.asar')) {
  var resourcesPath = path.resolve(__dirname, '..', '..', '..');
  CLI_PATH = path.join(resourcesPath, 'cli', 'snip.js');
  NODE_PATH = path.join(resourcesPath, 'node', 'node');
  // Fallback to system node if bundled node not found
  if (!require('fs').existsSync(NODE_PATH)) {
    NODE_PATH = findNodeBinary() || '/usr/local/bin/node';
  }
} else {
  CLI_PATH = path.join(__dirname, '..', 'cli', 'snip.js');
  NODE_PATH = process.argv[0]; // The node binary that launched this script
}

var PROTOCOL_VERSION = '2025-11-25';
var SERVER_NAME = 'snip';
var SERVER_VERSION = '1.1.0';

// ── MCP Tool Definitions ──

var TOOLS = [
  {
    name: 'search_screenshots',
    description: 'Search Snip screenshot library by description. USE THIS to find saved screenshots.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Search query' } },
      required: ['query']
    }
  },
  {
    name: 'list_screenshots',
    description: 'List all saved screenshots with metadata.',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'get_screenshot',
    description: 'Get screenshot metadata by file path.',
    inputSchema: {
      type: 'object',
      properties: { filepath: { type: 'string', description: 'Absolute path to screenshot' } },
      required: ['filepath']
    }
  },
  {
    name: 'transcribe_screenshot',
    description: 'Extract text from a screenshot via OCR. USE THIS to read text from images.',
    inputSchema: {
      type: 'object',
      properties: { filepath: { type: 'string', description: 'Absolute path to screenshot' } },
      required: ['filepath']
    }
  },
  {
    name: 'organize_screenshot',
    description: 'Queue screenshot for AI categorization.',
    inputSchema: {
      type: 'object',
      properties: { filepath: { type: 'string', description: 'Absolute path to screenshot' } },
      required: ['filepath']
    }
  },
  {
    name: 'get_categories',
    description: 'List all screenshot categories.',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'open_in_snip',
    description: 'Open image in Snip editor for user review. User can approve, annotate with spatial feedback, send text feedback, or request changes. Blocks until user finishes. Returns structured result with status (approved/changes_requested), edited flag, image path, and optional text feedback.',
    inputSchema: {
      type: 'object',
      properties: {
        filepath: { type: 'string', description: 'Path to image file (PNG/JPEG)' },
        imageDataURL: { type: 'string', description: 'Base64 data URL (fallback for sandboxed clients)' },
        message: { type: 'string', description: 'Context message to display to the user (e.g., what you need feedback on)' }
      },
      required: []
    }
  },
  {
    name: 'render_diagram',
    description: 'Render a diagram (e.g. Mermaid) to PNG and open in Snip editor for user review. User can approve, annotate with spatial feedback, send text feedback, or request changes. Blocks until the user finishes. Returns structured result with status, edited flag, image path, and optional text feedback.',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Diagram source code (e.g. Mermaid syntax like "graph TD; A-->B")' },
        format: { type: 'string', description: 'Diagram format (default: mermaid)', enum: ['mermaid'] },
        message: { type: 'string', description: 'Context message to display to the user' }
      },
      required: ['code']
    }
  },
  {
    name: 'install_extension',
    description: 'Install a sandboxed extension into Snip. Requires user approval. Only action-tool and processor types. All IPC channels must use ext: prefix.\n\nExample:\n  name: "word-counter"\n  manifest: { name: "word-counter", displayName: "Word Counter", type: "action-tool", ipc: [{ channel: "ext:word-counter:count", method: "count" }] }\n  mainCode: "async function count(event, { text }) { return { words: text.split(/\\\\s+/).length }; }\\nmodule.exports = { count };"',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Extension name (alphanumeric + hyphens)' },
        manifest: { type: 'object', description: 'Extension manifest object' },
        mainCode: { type: 'string', description: 'JavaScript source for main.js' }
      },
      required: ['name', 'manifest']
    }
  }
];

// ── CLI execution ──

function mapToolToCli(toolName, args) {
  switch (toolName) {
    case 'search_screenshots': return ['search', args.query || ''];
    case 'list_screenshots': return ['list'];
    case 'get_screenshot': return ['get', args.filepath || ''];
    case 'transcribe_screenshot': return ['transcribe', args.filepath || ''];
    case 'organize_screenshot': return ['organize', args.filepath || ''];
    case 'get_categories': return ['categories'];
    case 'open_in_snip':
      // imageDataURL can't go through CLI (too large for argv, path.resolve breaks it)
      if (!args.filepath && args.imageDataURL) return null;
      var cliArgs = ['open', args.filepath || ''];
      if (args.message) cliArgs.push('--message', args.message);
      return cliArgs;
    case 'render_diagram': return null; // diagram code can be large, use socket directly
    case 'install_extension': return null; // handled via socket directly
    default: return null;
  }
}

function execCli(cliArgs, timeout) {
  return new Promise(function (resolve, reject) {
    var child = execFile(NODE_PATH, [CLI_PATH].concat(cliArgs), {
      timeout: timeout !== undefined ? timeout : 30000,
      maxBuffer: 50 * 1024 * 1024
    }, function (err, stdout, stderr) {
      if (err) {
        reject(new Error(stderr.trim() || err.message));
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

// For install_extension, we still need direct socket (it needs to pass complex JSON)
var net = require('net');
var os = require('os');
var SOCKET_PATH = path.join(os.homedir(), 'Library', 'Application Support', 'snip', 'snip.sock');

function callSocket(action, params) {
  return new Promise(function (resolve, reject) {
    var conn = net.createConnection(SOCKET_PATH);
    var buffer = '';
    var id = 'mcp-' + Date.now();

    conn.on('connect', function () {
      conn.write(JSON.stringify({ id: id, action: action, params: params || {} }) + '\n');
    });

    conn.on('data', function (chunk) {
      buffer += chunk.toString();
      var idx = buffer.indexOf('\n');
      if (idx !== -1) {
        var line = buffer.slice(0, idx).trim();
        conn.end();
        try {
          var resp = JSON.parse(line);
          if (resp.error) reject(new Error(resp.error));
          else resolve(resp.result);
        } catch { reject(new Error('Invalid response')); }
      }
    });

    conn.on('error', function (err) {
      reject(new Error('Cannot connect to Snip: ' + err.message));
    });
  });
}

// ── MCP Protocol ──

var useFramedOutput = false;

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
    var content;

    if (toolName === 'install_extension') {
      // install_extension needs direct socket (complex JSON params)
      var result = await callSocket('install_extension', args);
      content = [{ type: 'text', text: JSON.stringify(result, null, 2) }];
    } else {
      var cliArgs = mapToolToCli(toolName, args);
      if (!cliArgs) {
        // Fallback to direct socket for tools that can't go through CLI (e.g., open_in_snip with imageDataURL)
        var socketResult = await callSocket(toolName, args);
        content = [{ type: 'text', text: JSON.stringify(socketResult, null, 2) }];
        sendResult(id, { content: content });
        return;
      }

      // open_in_snip blocks indefinitely — no timeout
      var timeout = toolName === 'open_in_snip' ? 0 : 30000;
      var stdout = await execCli(cliArgs, timeout);

      if (toolName === 'open_in_snip') {
        // stdout is structured JSON with status, path, edited, text, message
        content = [{ type: 'text', text: stdout }];
      } else if (toolName === 'transcribe_screenshot') {
        // stdout is plain text
        content = [{ type: 'text', text: stdout }];
      } else {
        // stdout is JSON
        content = [{ type: 'text', text: stdout }];
      }
    }

    sendResult(id, { content: content });
  } catch (err) {
    sendResult(id, {
      content: [{ type: 'text', text: 'Error: ' + err.message }],
      isError: true
    });
  }
}

// ── Stdio Transport (auto-detect framing) ──

function startStdioTransport() {
  var buffer = '';
  var contentLength = null;
  var framed = null;

  function processMessage(body) {
    try {
      var msg = JSON.parse(body);
      handleRequest(msg).catch(function (err) {
        if (msg.id !== undefined) sendError(msg.id, -32603, err.message);
      });
    } catch {}
  }

  function processFramed() {
    while (buffer.length > 0) {
      if (contentLength === null) {
        var headerEnd = buffer.indexOf('\r\n\r\n');
        var sepLen = 4;
        if (headerEnd === -1) { headerEnd = buffer.indexOf('\n\n'); sepLen = 2; }
        if (headerEnd === -1) return;
        var header = buffer.slice(0, headerEnd);
        var match = header.match(/Content-Length:\s*(\d+)/i);
        if (!match) { buffer = buffer.slice(headerEnd + sepLen); continue; }
        contentLength = parseInt(match[1]);
        if (contentLength > 10 * 1024 * 1024) { buffer = buffer.slice(headerEnd + sepLen); contentLength = null; continue; }
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
    var idx;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      var line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (line) processMessage(line);
    }
  }

  process.stdin.on('data', function (chunk) {
    buffer += chunk.toString();
    if (buffer.length > 16 * 1024 * 1024) { buffer = ''; return; }
    if (framed === null) {
      var trimmed = buffer.trimStart();
      if (trimmed.startsWith('{')) { framed = false; useFramedOutput = false; }
      else { framed = true; useFramedOutput = true; }
    }
    if (framed) processFramed();
    else processLines();
  });

  process.stdin.on('end', function () { process.exit(0); });
}

startStdioTransport();
