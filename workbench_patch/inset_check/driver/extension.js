// Evals the POSTed body as an async function with `vscode` in scope, answers {ok, result|error}.
const vscode = require('vscode')
const http = require('http')

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const port = Number(process.env.INSET_CHECK_DRIVER_PORT || 9372)

function activate(context) {
  const server = http.createServer((request, response) => {
    let body = ''
    request.on('data', chunk => body += chunk)
    request.on('end', async () => {
      try {
        const result = await new AsyncFunction('vscode', body)(vscode)
        response.end(JSON.stringify({ ok: true, result }))
      } catch (error) {
        response.end(JSON.stringify({ ok: false, error: String(error && error.stack || error) }))
      }
    })
  })
  server.listen(port, '127.0.0.1')
  context.subscriptions.push({ dispose: () => server.close() })
}

module.exports = { activate }
