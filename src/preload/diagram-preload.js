const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('snip', {
  onDiagramCode: function (callback) {
    ipcRenderer.on('render-diagram-code', function (event, data) {
      callback(data);
    });
  },
  diagramRendered: function (result) {
    ipcRenderer.send('diagram-rendered', result);
  }
});
