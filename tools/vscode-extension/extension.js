'use strict'

const vscode = require('vscode')
const tools = require('./tools.js')
const pcsxRedux = require('./pcsx-redux.js')
const templates = require('./templates.js')
const os = require('node:os')

class PSXDevPanel {
  static currentPanel = undefined

  static createOrShow (extensionUri) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined
    // If we already have a panel, show it.
    if (PSXDevPanel.currentPanel) {
      PSXDevPanel.currentPanel._panel.reveal(column)
      return
    }
    // Otherwise, create a new panel.
    const panel = vscode.window.createWebviewPanel(
      PSXDevPanel.viewType,
      'PSX.Dev',
      column || vscode.ViewColumn.One,
      getWebviewOptions(extensionUri)
    )
    PSXDevPanel.currentPanel = new PSXDevPanel(panel, extensionUri)
  }

  static revive (panel, extensionUri) {
    PSXDevPanel.currentPanel = new PSXDevPanel(panel, extensionUri)
  }

  constructor (panel, extensionUri) {
    this._disposables = []
    this._panel = panel
    this._extensionUri = extensionUri
    // Set the webview's initial html content
    this._update()
    // Listen for when the panel is disposed
    // This happens when the user closes the panel or when the panel is closed programmatically
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables)
    // Update the content based on view changes
    this._panel.onDidChangeViewState(
      () => {
        if (this._panel.visible) {
          this._update()
        }
      },
      null,
      this._disposables
    )
    // Handle messages from the webview
    this._panel.webview.onDidReceiveMessage(
      (message) => {
        switch (message.command) {
          case 'alert':
            vscode.window.showErrorMessage(message.text)
            break
          case 'getTemplates':
            this._panel.webview.postMessage({ command: 'templates', templates: templates.list })
            break
          case 'refreshTools':
            tools.refreshAll().then((tools) => {
              this._panel.webview.postMessage({ command: 'tools', tools })
            })
            break
          case 'openUrl':
            vscode.env.openExternal(vscode.Uri.parse(message.url))
            break
          case 'installTools':
            tools
              .install(message.tools, message.force)
              .then((requiresReboot) => {
                if (requiresReboot) {
                  this._panel.webview.postMessage({ command: 'requireReboot' })
                  vscode.window.showInformationMessage('Some tools require a reboot to work properly. Please reboot your system before resuming installing more tools.')
                } else {
                  return tools.refreshAll()
                }
              })
              .then((tools) => {
                this._panel.webview.postMessage({ command: 'tools', tools })
              }).catch(() => {
                this._panel.webview.postMessage({ command: 'tools', tools: tools.list })
              })
            break
          case 'launchRedux':
            tools.maybeInstall('redux').then(() => { return tools.list.redux.launch() })
          case 'restorePsyq':
            break
          case 'requestHomeDirectory':
            this._panel.webview.postMessage({ command: 'projectDirectory', path: os.homedir() })
            break
          case 'browseForProjectDirectory':
            break
        }
      },
      null,
      this._disposables
    )
  }

  dispose () {
    PSXDevPanel.currentPanel = undefined
    // Clean up our resources
    this._panel.dispose()
    while (this._disposables.length) {
      const x = this._disposables.pop()
      if (x) {
        x.dispose()
      }
    }
  }

  _update () {
    const webview = this._panel.webview
    webview.html = this._getHtmlForWebview(webview)
  }

  _getHtmlForWebview (webview) {
    const scriptPathOnDisk = vscode.Uri.joinPath(
      this._extensionUri,
      'media',
      'main.js'
    )
    const scriptUri = webview.asWebviewUri(scriptPathOnDisk)
    const nonce = getNonce()
    return `<!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">

        <!--
          Use a content security policy to only allow loading images from https or from our extension directory,
          and only allow scripts that have a specific nonce.
        -->
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} https:; script-src 'nonce-${nonce}';">

        <meta name="viewport" content="width=device-width, initial-scale=1.0">

        <title>PSX.Dev</title>
      </head>
      <body>
        <vscode-button id="refresh">Refresh</vscode-button>
        <vscode-panels>
          <vscode-panel-tab id="welcome-tab">WELCOME</vscode-panel-tab>
          <vscode-panel-tab id="templates-tab">TEMPLATES</vscode-panel-tab>
          <vscode-panel-tab id="tools-tab">TOOLS</vscode-panel-tab>
          <vscode-panel-view id="welcome-view">
            <div>
              <h1>Welcome to the PSX.Dev VSCode extension</h1>
              <p>Using this extension, you can install and maintain the necessary tools to develop PS1 software, and create projects based on templates. Click on the tabs above to get started. </p>
              <p>You can always use the commands in the Command Palette (Ctrl+Shift+P) to access this panel again. Search for the <b>PSX.Dev: Show Panel</b> command.</p>
              <p>You can access more information about PlayStation 1 development on the <vscode-link href="https://psx.dev/" target="_blank">PSX.Dev website</vscode-link>. Please do not hesitate to join the <vscode-link href="https://discord.gg/QByKPpH" target="_blank">Discord server</vscode-link>!</p>
              <p>The TOOLS panel will have the ability to install the tools on the most popular platforms, but there's definitely corner cases when it won't work. When manual installation is required, either look at the homepage provided for each tool, or check the <vscode-link href="https://github.com/grumpycoders/pcsx-redux/blob/main/src/mips/psyqo/GETTING_STARTED.md" target="_blank">installation instructions</vscode-link> provided in the documentation. Additionally, the panel can leverage <vscode-link href="https://docs.brew.sh/Homebrew-on-Linux" target="_blank">Linuxbrew</vscode-link> to install dependencies on an unsupported Linux platform.</p>
              <hr/>
              <p>Before debugging a PlayStation 1 application, you'll need to have a target able to run PlayStation 1 code accessible through the gdb protocol. You can <vscode-link href="https://unirom.github.io/debug_gdb/" target="_blank">connect to a real PlayStation 1</vscode-link>, or you can run an emulator with a gdb server. You can click the button below to launch the <vscode-link href="https://pcsx-redux.consoledev.net" target="_blank">PCSX-Redux</vscode-link> PlayStation 1 emulator in debugger mode.</p><br/>
              <vscode-button id="launch-redux">Launch PCSX-Redux</vscode-button><br/>
              <hr/>
              <p>After cloning a project that uses the Psy-Q library, it'll be necessary to restore it. You can press the button below in order to restore the library into the current workspace.</p><br/>
              <vscode-button id="restore-psyq">Restore Psy-Q</vscode-button><br/>
              <hr/>
            </div>
          </vscode-panel-view>
          <vscode-panel-view id="templates-view"><vscode-progress-ring></vscode-progress-ring></vscode-panel-view>
          <vscode-panel-view id="tools-view"><vscode-progress-ring></vscode-progress-ring></vscode-panel-view>
        </vscode-panels>
        <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
      </body>
      </html>`
  }
}

PSXDevPanel.viewType = 'psxDev'

function activate (context) {
  tools.setExtensionUri(context.extensionUri)
  tools.setGlobalStorageUri(context.globalStorageUri)
  pcsxRedux.setGlobalStorageUri(context.globalStorageUri)
  context.subscriptions.push(
    vscode.commands.registerCommand('psxDev.showPanel', () => {
      PSXDevPanel.createOrShow(context.extensionUri)
    })
  )

  vscode.window.registerWebviewPanelSerializer(PSXDevPanel.viewType, {
    async deserializeWebviewPanel (webviewPanel, state) {
      webviewPanel.webview.options = getWebviewOptions(context.extensionUri)
      PSXDevPanel.revive(webviewPanel, context.extensionUri)
    }
  })
}

function getWebviewOptions (extensionUri) {
  return {
    enableScripts: true,
    localResourceRoots: [
      vscode.Uri.joinPath(extensionUri, 'media'),
      vscode.Uri.joinPath(extensionUri, 'node_modules', '@vscode', 'webview-ui-toolkit', 'dist')
    ]
  }
}

function getNonce () {
  let text = ''
  const possible =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length))
  }
  return text
}

// This method is called when your extension is deactivated
function deactivate () {}

module.exports = {
  activate,
  deactivate
}
