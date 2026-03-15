let ctx = null;

function init(context) {
  ctx = context;
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

module.exports = { init, upscaleImage, killWorker };
