const { configureTransformersEnv } = require('../model-paths');

let pipeline = null;
let pipelinePromise = null;

async function getPipeline() {
  if (pipeline) return pipeline;
  if (pipelinePromise) return pipelinePromise;

  pipelinePromise = (async () => {
    // Dynamic import since @huggingface/transformers is ESM
    const transformers = await import('@huggingface/transformers');

    // Point Transformers.js at bundled models (offline in packaged app)
    configureTransformersEnv(transformers.env);

    pipeline = await transformers.pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
      quantized: true
    });
    console.log('[Embeddings] Model loaded');
    return pipeline;
  })();

  return pipelinePromise;
}

async function embedText(text) {
  const pipe = await getPipeline();
  const output = await pipe(text, { pooling: 'mean', normalize: true });
  return output.data;
}

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function searchScreenshots(query) {
  const { readIndex } = require('../store');
  const index = readIndex();

  if (index.length === 0) return [];

  // Split entries into embedded vs non-embedded
  const withEmbeddings = index.filter(entry => entry.embedding);
  const withoutEmbeddings = index.filter(entry => !entry.embedding);

  let semanticResults = [];
  if (withEmbeddings.length > 0) {
    try {
      const queryEmbedding = await embedText(query);
      const queryArray = Array.from(queryEmbedding);

      semanticResults = withEmbeddings
        .map(entry => ({
          ...entry,
          score: cosineSimilarity(queryArray, entry.embedding)
        }));
    } catch (err) {
      console.error('[Search] Embedding search failed, falling back to text:', err.message);
      // Treat as non-embedded for text fallback
      withoutEmbeddings.push(...withEmbeddings);
    }
  }

  // Text matching for entries without embeddings
  const queryLower = query.toLowerCase();
  const words = queryLower.split(/\s+/);

  const textResults = withoutEmbeddings.map(entry => {
    const searchable = `${entry.filename || ''} ${entry.name || ''} ${entry.description || ''} ${(entry.tags || []).join(' ')} ${entry.category || ''}`.toLowerCase();
    let score = 0;
    for (const word of words) {
      if (searchable.includes(word)) score += 1;
    }
    return { ...entry, score: words.length > 0 ? score / words.length : 0 };
  });

  // Merge and sort by score
  return semanticResults
    .concat(textResults)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);
}

module.exports = { embedText, searchScreenshots };
