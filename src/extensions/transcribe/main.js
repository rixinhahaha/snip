let ctx = null;

function init(context) {
  ctx = context;
}

async function transcribeScreenshot(event) {
  const editorData = ctx.getEditorData();

  if (!editorData || !editorData.croppedDataURL) {
    return { success: false, error: 'No editor image available' };
  }

  try {
    const { transcribe } = require('../../main/transcription/transcription');
    const raw = editorData.croppedDataURL.replace(/^data:image\/\w+;base64,/, '');
    const result = await transcribe(raw);

    if (!result.success) {
      return { success: false, error: result.error || 'Transcription failed' };
    }

    return {
      success: true,
      languages: result.languages || ['unknown'],
      text: result.text || ''
    };
  } catch (err) {
    console.error('[Snip] Transcription failed:', err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { init, transcribeScreenshot };
