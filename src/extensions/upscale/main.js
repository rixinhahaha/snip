let ctx = null;

function init(context) {
  ctx = context;
}

async function checkSupport() {
  const addonManager = require('../../main/addon-manager');
  if (!addonManager.isAddonInstalled('upscale')) {
    return { supported: false, reason: 'addon_not_installed' };
  }
  return { supported: true };
}

async function upscaleImage(event, { imageBase64 }) {
  const { upscaleImage } = require('../../main/upscaler/upscaler');
  return upscaleImage(imageBase64, function (progress) {
    if (event.sender && !event.sender.isDestroyed()) {
      event.sender.send('upscale-progress', progress);
    }
  });
}

function killWorker() {
  const { killWorker } = require('../../main/upscaler/upscaler');
  killWorker();
}

module.exports = { init, checkSupport, upscaleImage, killWorker };
