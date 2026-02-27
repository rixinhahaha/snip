let pipeline = null;
let pipelinePromise = null;

async function getPipeline() {
  if (pipeline) return pipeline;
  if (pipelinePromise) return pipelinePromise;

  pipelinePromise = (async () => {
    // Dynamic import since @huggingface/transformers is ESM
    const { pipeline: createPipeline } = await import('@huggingface/transformers');
    pipeline = await createPipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
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

  // Check if any entries have embeddings
  const hasEmbeddings = index.some(entry => entry.embedding);

  if (hasEmbeddings) {
    // Semantic search using embeddings
    try {
      const queryEmbedding = await embedText(query);
      const queryArray = Array.from(queryEmbedding);

      const scored = index
        .filter(entry => entry.embedding)
        .map(entry => ({
          ...entry,
          score: cosineSimilarity(queryArray, entry.embedding)
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 20);

      return scored;
    } catch (err) {
      console.error('[Search] Embedding search failed, falling back to text:', err.message);
    }
  }

  // Fallback: simple text matching
  const queryLower = query.toLowerCase();
  const words = queryLower.split(/\s+/);

  const scored = index.map(entry => {
    const searchable = `${entry.name || ''} ${entry.description || ''} ${(entry.tags || []).join(' ')} ${entry.category || ''}`.toLowerCase();
    let score = 0;
    for (const word of words) {
      if (searchable.includes(word)) score += 1;
    }
    return { ...entry, score: score / words.length };
  })
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);

  return scored;
}

module.exports = { embedText, cosineSimilarity, searchScreenshots };
