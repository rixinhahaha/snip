const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');
const { isMainThread, parentPort } = require('worker_threads');
const { getApiKey, getAllCategories, addCustomCategory, getScreenshotsDir, addToIndex, getAllTagsWithDescriptions } = require('../store');

let client = null;
let workerApiKey = null; // decrypted key passed from main thread for worker context

/**
 * Set the API key for worker thread context (safeStorage unavailable in workers).
 */
function setWorkerApiKey(key) {
  workerApiKey = key;
  client = null; // reset client so it picks up new key
}

// Notification helper — works in both main thread and worker
function showNotification(title, body, onClickCategory) {
  if (isMainThread) {
    // In main thread, use Electron Notification directly
    const { Notification } = require('electron');
    const notification = new Notification({ title, body });
    if (onClickCategory) {
      notification.on('click', () => {
        addCustomCategory(onClickCategory);
        console.log('[Agent] Added new category:', onClickCategory);
      });
    }
    notification.show();
  } else if (parentPort) {
    // In worker thread, post message to main thread
    parentPort.postMessage({
      type: 'notification',
      title,
      body,
      onClickCategory
    });
  }
}

function getClient() {
  // In worker thread, use the injected key; on main thread, use store (which decrypts via safeStorage)
  const apiKey = isMainThread ? getApiKey() : (workerApiKey || '');
  if (!apiKey) return null;
  if (!client) {
    client = new Anthropic({ apiKey });
  }
  return client;
}

async function processScreenshot(filepath) {
  const anthropic = getClient();
  if (!anthropic) {
    console.log('[Agent] No API key, skipping');
    return;
  }

  // Verify file still exists (might have been moved)
  if (!fs.existsSync(filepath)) {
    console.log('[Agent] File no longer exists:', filepath);
    return;
  }

  // Read image as base64
  const imageBuffer = fs.readFileSync(filepath);
  const base64Image = imageBuffer.toString('base64');
  const ext = path.extname(filepath).toLowerCase();
  const mediaType = ext === '.png' ? 'image/png' : 'image/jpeg';

  // Get current categories with descriptions
  const tagsWithDescriptions = getAllTagsWithDescriptions();

  // Build the category list for the prompt — always include all categories
  const categoryDescriptions = tagsWithDescriptions
    .map(t => t.description ? `  - ${t.name}: ${t.description}` : `  - ${t.name}`)
    .join('\n');

  console.log('[Agent] Calling Claude API for: %s', path.basename(filepath));
  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: base64Image
              }
            },
            {
              type: 'text',
              text: `Analyze this screenshot and categorize it.

Available categories and their descriptions:
${categoryDescriptions}

Return ONLY a JSON object (no markdown, no code blocks):
{
  "category": "<best matching category from the list, or suggest a new descriptive one-word category>",
  "name": "<short-descriptive-kebab-case-name, max 5 words>",
  "description": "<1-2 sentence description of the screenshot content>",
  "tags": ["<relevant>", "<searchable>", "<keywords>"],
  "newCategory": false
}

Use the category descriptions to guide your choice. Pick the category whose description best matches the screenshot content.
Set newCategory to true ONLY if none of the available categories fit well.`
            }
          ]
        }
      ]
    });

    // Parse response
    const text = response.content[0].text.trim();
    console.log('[Agent] Response received (%d input tokens, %d output tokens)', response.usage.input_tokens, response.usage.output_tokens);
    let result;
    try {
      // Try to extract JSON if wrapped in code blocks
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      result = JSON.parse(jsonMatch ? jsonMatch[0] : text);
    } catch (parseErr) {
      console.error('[Agent] Failed to parse response:', text);
      result = { category: 'other', name: path.basename(filepath, ext), description: '', tags: [], newCategory: false };
    }
    console.log('[Agent] Result: category=%s name=%s tags=[%s]', result.category, result.name, result.tags.join(', '));

    // Handle new category suggestion
    if (result.newCategory && result.category) {
      showNotification(
        'Snip - New Category Suggested',
        `"${result.category}" — Click to add it to your categories.`,
        result.category
      );
    }

    // Ensure category folder exists
    const screenshotsDir = getScreenshotsDir();
    const categoryDir = path.join(screenshotsDir, result.category);
    fs.mkdirSync(categoryDir, { recursive: true });

    // Rename and move file
    const safeName = result.name
      .replace(/[^a-z0-9-]/gi, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase();
    const newFilename = `${safeName}${ext}`;
    const destPath = path.join(categoryDir, newFilename);

    // Handle name collision
    let finalPath = destPath;
    let counter = 1;
    while (fs.existsSync(finalPath)) {
      finalPath = path.join(categoryDir, `${safeName}-${counter}${ext}`);
      counter++;
    }

    fs.renameSync(filepath, finalPath);
    console.log('[Agent] Organized:', path.basename(filepath), '->', `${result.category}/${path.basename(finalPath)}`);

    // Add to index without embedding (embedding generated on main thread to avoid ONNX crash)
    const textToEmbed = `${result.name} ${result.description} ${result.tags.join(' ')}`;
    addToIndex({
      filename: path.basename(finalPath),
      path: finalPath,
      category: result.category,
      name: result.name,
      description: result.description,
      tags: result.tags,
      embedding: null,
      createdAt: new Date().toISOString()
    });

    return { ...result, finalPath, textToEmbed };
  } catch (apiErr) {
    console.error('[Agent] API call failed:', apiErr.message);
    throw apiErr;
  }
}

// Reset client when API key changes
function resetClient() {
  client = null;
}

module.exports = { processScreenshot, resetClient, setWorkerApiKey };
