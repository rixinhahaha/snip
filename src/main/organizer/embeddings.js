/**
 * Embeddings module — delegates text embedding to an isolated child process.
 * The worker runs with NODE_PATH pointing to the addon runtime so it can
 * find @huggingface/transformers without it being in the app's node_modules.
 */
const path = require('path');
const addonManager = require('../addon-manager');
const { createWorkerProcess } = require('../worker-process');

var wp = createWorkerProcess({
  workerScript: path.join(__dirname, 'embeddings-worker.js'),
  logPrefix: '[Embeddings]',
  timeoutMs: 60000
});

async function embedText(text) {
  if (!addonManager.isAddonInstalled('smart-search')) {
    throw new Error('Smart Search add-on not installed');
  }
  return wp.sendRequest({ type: 'embed', text: text });
}

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  var dotProduct = 0;
  var normA = 0;
  var normB = 0;
  for (var i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function searchScreenshots(query) {
  var { readIndex } = require('../store');
  var index = readIndex();

  if (index.length === 0) return [];

  var withEmbeddings = index.filter(function (entry) { return entry.embedding; });
  var withoutEmbeddings = index.filter(function (entry) { return !entry.embedding; });

  var semanticResults = [];
  if (withEmbeddings.length > 0 && addonManager.isAddonInstalled('smart-search')) {
    try {
      var queryEmbedding = await embedText(query);
      var queryArray = Array.isArray(queryEmbedding) ? queryEmbedding : Array.from(queryEmbedding);

      semanticResults = withEmbeddings
        .map(function (entry) {
          return Object.assign({}, entry, {
            score: cosineSimilarity(queryArray, entry.embedding)
          });
        });
    } catch (err) {
      console.error('[Search] Embedding search failed, falling back to text:', err.message);
      withoutEmbeddings.push.apply(withoutEmbeddings, withEmbeddings);
    }
  } else {
    withoutEmbeddings.push.apply(withoutEmbeddings, withEmbeddings);
  }

  var queryLower = query.toLowerCase();
  var words = queryLower.split(/\s+/);

  var textResults = withoutEmbeddings.map(function (entry) {
    var searchable = (entry.filename || '') + ' ' + (entry.name || '') + ' ' + (entry.description || '') + ' ' + (entry.tags || []).join(' ') + ' ' + (entry.category || '');
    searchable = searchable.toLowerCase();
    var score = 0;
    for (var i = 0; i < words.length; i++) {
      if (searchable.includes(words[i])) score += 1;
    }
    return Object.assign({}, entry, { score: words.length > 0 ? score / words.length : 0 });
  });

  return semanticResults
    .concat(textResults)
    .sort(function (a, b) { return b.score - a.score; })
    .slice(0, 20);
}

function killWorker() {
  wp.killWorker();
}

module.exports = { embedText, searchScreenshots, cosineSimilarity, killWorker };
