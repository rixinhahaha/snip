const { Ollama } = require('ollama');
const fs = require('fs');
const path = require('path');
const { isMainThread, parentPort } = require('worker_threads');
const { getAllCategories, addCustomCategory, getScreenshotsDir, addToIndex, getAllTagsWithDescriptions } = require('../store');
const { getOllamaModel, getOllamaUrl } = require('../store');

// Notification helper — works in both main thread and worker
function showNotification(title, body, onClickCategory) {
  if (isMainThread) {
    var { Notification } = require('electron');
    var notification = new Notification({ title: title, body: body });
    if (onClickCategory) {
      notification.on('click', function () {
        addCustomCategory(onClickCategory);
        console.log('[Agent] Added new category:', onClickCategory);
      });
    }
    notification.show();
  } else if (parentPort) {
    parentPort.postMessage({
      type: 'notification',
      title: title,
      body: body,
      onClickCategory: onClickCategory
    });
  }
}

/**
 * Create a new Ollama client for the configured URL.
 * Each call creates a fresh client so we always pick up config changes.
 */
function createClient() {
  return new Ollama({ host: getOllamaUrl() });
}

async function processScreenshot(filepath) {
  var ollama = createClient();

  // Verify file still exists (might have been moved)
  if (!fs.existsSync(filepath)) {
    console.log('[Agent] File no longer exists:', filepath);
    return;
  }

  // Read image as base64
  var imageBuffer = fs.readFileSync(filepath);
  var base64Image = imageBuffer.toString('base64');
  var ext = path.extname(filepath).toLowerCase();

  // Get current categories with descriptions
  var tagsWithDescriptions = getAllTagsWithDescriptions();

  // Build the category list for the prompt — always include all categories
  var categoryDescriptions = tagsWithDescriptions
    .map(function (t) { return t.description ? '  - ' + t.name + ': ' + t.description : '  - ' + t.name; })
    .join('\n');

  var prompt = 'Analyze this screenshot and categorize it.\n\n' +
    'Available categories and their descriptions:\n' +
    categoryDescriptions + '\n\n' +
    'Return ONLY a JSON object (no markdown, no code blocks):\n' +
    '{\n' +
    '  "category": "<best matching category from the list, or suggest a new descriptive one-word category>",\n' +
    '  "name": "<short-descriptive-kebab-case-name, max 5 words>",\n' +
    '  "description": "<1-2 sentence description of the screenshot content>",\n' +
    '  "tags": ["<relevant>", "<searchable>", "<keywords>"],\n' +
    '  "newCategory": false\n' +
    '}\n\n' +
    'Use the category descriptions to guide your choice. Pick the category whose description best matches the screenshot content.\n' +
    'Set newCategory to true ONLY if none of the available categories fit well.';

  var model = getOllamaModel();
  console.log('[Agent] Using model "%s" for inference at %s', model, new Date().toISOString());
  console.log('[Agent] Calling Ollama (%s) for: %s', model, path.basename(filepath));

  try {
    var response = await ollama.chat({
      model: model,
      messages: [
        {
          role: 'user',
          content: prompt,
          images: [base64Image]
        }
      ],
      format: 'json',
      stream: false
    });

    // Parse response
    var text = response.message.content.trim();
    console.log('[Agent] Response received (%d chars)', text.length);
    var result;
    try {
      // Try to extract JSON if wrapped in code blocks
      var jsonMatch = text.match(/\{[\s\S]*\}/);
      result = JSON.parse(jsonMatch ? jsonMatch[0] : text);
    } catch (parseErr) {
      console.error('[Agent] Failed to parse response:', text);
      result = { category: 'other', name: path.basename(filepath, ext), description: '', tags: [], newCategory: false };
    }
    console.log('[Agent] Result: category=%s name=%s tags=[%s]', result.category, result.name, (result.tags || []).join(', '));

    // Handle new category suggestion
    if (result.newCategory && result.category) {
      showNotification(
        'Snip - New Category Suggested',
        '"' + result.category + '" — Click to add it to your categories.',
        result.category
      );
    }

    // Ensure category folder exists
    var screenshotsDir = getScreenshotsDir();
    var categoryDir = path.join(screenshotsDir, result.category);
    fs.mkdirSync(categoryDir, { recursive: true });

    // Rename and move file
    var safeName = result.name
      .replace(/[^a-z0-9-]/gi, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase();
    var newFilename = safeName + ext;
    var destPath = path.join(categoryDir, newFilename);

    // Handle name collision
    var finalPath = destPath;
    var counter = 1;
    while (fs.existsSync(finalPath)) {
      finalPath = path.join(categoryDir, safeName + '-' + counter + ext);
      counter++;
    }

    fs.renameSync(filepath, finalPath);
    console.log('[Agent] Organized:', path.basename(filepath), '->', result.category + '/' + path.basename(finalPath));

    // Add to index without embedding (embedding generated on main thread to avoid ONNX crash)
    var textToEmbed = result.name + ' ' + result.description + ' ' + (result.tags || []).join(' ');
    addToIndex({
      filename: path.basename(finalPath),
      path: finalPath,
      category: result.category,
      name: result.name,
      description: result.description,
      tags: result.tags || [],
      embedding: null,
      createdAt: new Date().toISOString()
    });

    return { category: result.category, name: result.name, description: result.description, tags: result.tags, finalPath: finalPath, textToEmbed: textToEmbed };
  } catch (apiErr) {
    console.error('[Agent] Ollama call failed:', apiErr.message);
    throw apiErr;
  }
}

module.exports = { processScreenshot };
