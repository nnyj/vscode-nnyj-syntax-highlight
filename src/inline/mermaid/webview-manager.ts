import * as vscode from 'vscode';
import { ColorThemeKind } from 'vscode';
import type { PendingRender, RenderResponse } from './types';
import { MERMAID_CONSTANTS } from './constants';
import { createErrorSvg } from './error-handler';
import { logWarn } from '../logging';

/**
 * Manages the Mermaid webview lifecycle and communication
 */
export class MermaidWebviewManager {
  private webviewView: vscode.WebviewView | undefined;
  private webview_ready = false;
  private readonly webview_waiters = new Set<{
    resolve: () => void;
    reject: (error: Error) => void;
  }>();
  private pendingRenders = new Map<string, PendingRender>();
  private renderRequestCounter = 0;
  private messageHandlerDisposable: vscode.Disposable | undefined;
  private switch_back_timeout_id: NodeJS.Timeout | undefined;
  private _extensionContext: vscode.ExtensionContext | undefined;
  private disposed = false;

  /**
   * Get the extension context (for use by webview provider)
   */
  get extensionContext(): vscode.ExtensionContext | undefined {
    return this._extensionContext;
  }

  /**
   * Initialize the webview manager with extension context
   */
  initialize(context: vscode.ExtensionContext): void {
    this._extensionContext = context;

    // Register the webview view provider
    const provider = new MermaidWebviewViewProvider(this);
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(
        MermaidWebviewViewProvider.viewType,
        provider,
        { webviewOptions: { retainContextWhenHidden: true } }
      )
    );

    // Open the mermaid view briefly to initialize it, then switch back
    // Focus the view so VS Code calls resolveWebviewView() (hidden views are not resolved by opening the container only)
    void this.ensureWebviewThenSwitchBack();
  }

  /**
   * Focus the Mermaid view to trigger webview creation, wait for it (or 5s), then switch back to Explorer.
   */
  private ensureWebviewThenSwitchBack(): void {
    const WEBVIEW_READY_TIMEOUT_MS = 5000;

    vscode.commands
      .executeCommand('mdInline.mermaidRenderer.focus')
      .then(
        async () => {
          if (this.disposed) {
            return;
          }

          try {
            await this.waitForWebview(undefined, WEBVIEW_READY_TIMEOUT_MS);
          } catch (error) {
            if (this.disposed) {
              return;
            }
            logWarn('Mermaid: Webview not ready after opening view', error);
          }

          if (this.disposed) {
            return;
          }
          this.schedule_switch_back();
        },
        (err: unknown) => {
          if (!this.disposed && err !== undefined) {
            logWarn('Mermaid: Failed to focus view', err);
          }
        }
      );
  }

  private schedule_switch_back(): void {
    const SWITCH_BACK_DELAY_MS = 100;

    if (this.disposed) {
      return;
    }
    this.switch_back_timeout_id = setTimeout(() => {
      this.switch_back_timeout_id = undefined;
      if (this.disposed) {
        return;
      }

      void vscode.commands.executeCommand('workbench.view.explorer').then(undefined, (error: unknown) => {
        if (!this.disposed) {
          logWarn('Mermaid: Failed to return to Explorer', error);
        }
      });
    }, SWITCH_BACK_DELAY_MS);
  }

  /**
   * Set the webview view instance
   */
  setWebviewView(view: vscode.WebviewView): void {
    if (this.disposed) {
      return;
    }

    this.webviewView = view;
    this.webview_ready = false;
  }

  /**
   * Get the webview HTML content
   */
  getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    // Use local Mermaid bundle (no internet required)
    const mermaidScriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'dist', 'mermaid', 'mermaid.esm.min.mjs')
    );
    
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      padding: 20px;
      line-height: 1.6;
    }
    .info-box {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      padding: 16px;
      margin-bottom: 16px;
    }
    .info-box h3 {
      margin-top: 0;
      color: var(--vscode-textLink-foreground);
    }
    .info-box p {
      margin: 8px 0;
      color: var(--vscode-descriptionForeground);
    }
    .hidden {
      display: none;
    }
  </style>
</head>
<body>
  <div class="info-box">
    <h3>Mermaid Diagram Renderer</h3>
    <p>This webview is used internally by the Markdown Inline Editor extension to render Mermaid diagrams inline in your markdown files.</p>
    <p><strong>You can safely ignore this view.</strong> It runs in the background and has no user-facing functionality. The diagrams appear directly in your editor, not here.</p>
    <p>If you're seeing this view, you can close it and return to your editor. The extension will continue to work normally.</p>
  </div>
  <div id="renderContainer" class="hidden"></div>
  <script type="module">
    import mermaid from '${mermaidScriptUri}';
    
    const vscode = acquireVsCodeApi();

    function getDiagramType(source) {
      const firstNonEmptyLine = source
        .split(/\\r?\\n/)
        .map((l) => l.trim())
        .find((l) => l.length > 0);
      if (!firstNonEmptyLine) return 'unknown';
      return firstNonEmptyLine.split(/\\s+/)[0] || 'unknown';
    }

    
    window.addEventListener('message', async (event) => {
      const data = event.data;
      
      if (!data || !data.source) {
        return;
      }

      const requestId = data.requestId;
      const diagramType = getDiagramType(data.source);
      
      try {
        // Initialize Mermaid with theme and font settings
        mermaid.initialize({
          theme: data.darkMode ? 'dark' : 'default',
          fontFamily: data.fontFamily || undefined,
          startOnLoad: false,
          securityLevel: 'strict',
        });
        // Render the diagram - Mermaid v11 returns { svg } from render()
        // Gantt depends on parentElement.offsetWidth; when webview layout width is 0,
        // create a hidden container with explicit width to give Mermaid a real layout width.
        let svg;
        let renderContainer;
        // Use timestamp + random to ensure unique render IDs (prevents conflicts with concurrent renders)
        const renderId = 'mermaid-' + Date.now() + '-' + Math.random().toString(36).substring(2, 9);
        
        if (diagramType === 'gantt') {
          renderContainer = document.createElement('div');
          renderContainer.style.position = 'absolute';
          renderContainer.style.left = '-10000px';
          renderContainer.style.top = '0';
          renderContainer.style.width = '2000px';
          renderContainer.style.height = '1px';
          renderContainer.style.visibility = 'hidden';
          document.body?.appendChild(renderContainer);
        }

        try {
          // Only pass container parameter if it exists (Mermaid v11 supports optional container)
          // Passing undefined explicitly might cause issues, so conditionally call render
          const result = renderContainer
            ? await mermaid.render(renderId, data.source, renderContainer)
            : await mermaid.render(renderId, data.source);
          svg = result.svg;
        } finally {
          // Always clean up container if it was created
          if (renderContainer) {
            renderContainer.remove();
          }
        }
        
        // Send SVG string back with requestId to match to correct pending render
        vscode.postMessage({ svg, requestId });
      } catch (error) {
        // Send detailed error information back with requestId
        const errorInfo = {
          message: error?.message || 'Unknown error',
          name: error?.name || 'Error',
          stack: error?.stack || '',
          toString: error?.toString?.() || String(error)
        };
        // Include full error details - prioritize message, fallback to toString
        const errorMessage = errorInfo.message || errorInfo.toString || 'Unknown error occurred';
        vscode.postMessage({ error: errorMessage, requestId });
      }
    });
    
    // Signal ready after mermaid is loaded
    vscode.postMessage({ ready: true });
  </script>
</body>
</html>`;
  }

  /**
   * Handle messages from the webview
   */
  handleWebviewMessage(message: RenderResponse): void {
    if (message && message.ready) {
      this.webview_ready = true;
      for (const waiter of [...this.webview_waiters]) {
        waiter.resolve();
      }
      return;
    }

    if (message && message.error) {
      const requestId = message.requestId;
      if (requestId && this.pendingRenders.has(requestId)) {
        const { resolve, timeoutId } = this.pendingRenders.get(requestId)!;
        // Clear timeout since we're handling the error
        clearTimeout(timeoutId);
        // Create a proper error SVG - height will be adjusted in getMermaidDecoration
        const isDark = vscode.window.activeColorTheme.kind === ColorThemeKind.Dark ||
          vscode.window.activeColorTheme.kind === ColorThemeKind.HighContrast;
        const errorSvg = createErrorSvg(
          message.error,
          400, // Default width - will be resized later
          200, // Default height - will be resized later
          isDark
        );
        resolve(errorSvg);
        this.pendingRenders.delete(requestId);
      }
      return;
    }

    // Handle SVG response (with requestId) or legacy string format
    if (message && message.requestId && this.pendingRenders.has(message.requestId)) {
      const requestId = message.requestId;
      const { resolve, timeoutId } = this.pendingRenders.get(requestId)!;
      // Clear timeout since we received the response
      clearTimeout(timeoutId);
      // message.svg should always be present for RenderResponse with requestId
      const svg = message.svg || '';
      resolve(svg);
      this.pendingRenders.delete(requestId);
      return;
    }

    // Legacy support: string message without requestId (for backwards compatibility)
    if (typeof message === 'string') {
      // If there's only one pending render, use it (backwards compatibility)
      if (this.pendingRenders.size === 1) {
        const [requestId, { resolve, timeoutId }] = Array.from(this.pendingRenders.entries())[0];
        clearTimeout(timeoutId);
        resolve(message);
        this.pendingRenders.delete(requestId);
      }
    }
  }

  /**
   * Set the message handler disposable for cleanup
   */
  setMessageHandlerDisposable(disposable: vscode.Disposable): void {
    this.messageHandlerDisposable?.dispose();
    this.messageHandlerDisposable = disposable;
  }

  /**
   * Request SVG rendering with timeout and optional cancellation
   */
  async requestSvg(
    data: { source: string; darkMode: boolean; fontFamily?: string },
    timeoutMs: number = MERMAID_CONSTANTS.REQUEST_TIMEOUT_MS,
    cancellationToken?: vscode.CancellationToken
  ): Promise<string> {
    if (!this.webviewView) {
      throw new Error('Webview not available');
    }

    // Generate unique request ID for this render
    const requestId = `req-${Date.now()}-${++this.renderRequestCounter}`;

    // Create promise BEFORE posting message (like Markless pattern)
    // Track pending renders in a Map to handle concurrent requests
    return new Promise<string>((resolve, reject) => {
      if (!this.webviewView) {
        reject(new Error('Webview not available'));
        return;
      }
      
      // Check cancellation token before starting
      if (cancellationToken?.isCancellationRequested) {
        reject(new vscode.CancellationError());
        return;
      }
      
      // Set up cancellation listener if token provided
      let cancellationListener: vscode.Disposable | undefined;
      if (cancellationToken) {
        cancellationListener = cancellationToken.onCancellationRequested(() => {
          if (this.pendingRenders.has(requestId)) {
            const { timeoutId } = this.pendingRenders.get(requestId)!;
            clearTimeout(timeoutId);
            this.pendingRenders.delete(requestId);
            cancellationListener?.dispose();
            reject(new vscode.CancellationError());
          }
        });
      }
      
      // Set up timeout to prevent promise leaks from failed requests
      const timeoutId = setTimeout(() => {
        if (this.pendingRenders.has(requestId)) {
          this.pendingRenders.delete(requestId);
          cancellationListener?.dispose();
          reject(new Error('Mermaid render request timed out'));
        }
      }, timeoutMs);
      
      // Wrap resolve/reject to clear timeout and cancellation listener
      const wrappedResolve = (value: string) => {
        clearTimeout(timeoutId);
        cancellationListener?.dispose();
        resolve(value);
      };
      
      const wrappedReject = (error: Error) => {
        clearTimeout(timeoutId);
        cancellationListener?.dispose();
        reject(error);
      };
      
      // Store resolve/reject with timeout ID in Map
      this.pendingRenders.set(requestId, { 
        resolve: wrappedResolve, 
        reject: wrappedReject,
        timeoutId 
      });

      try {
        // Include requestId in message so webview can send it back
        this.webviewView.webview.postMessage({ ...data, requestId });
      } catch (error) {
        // Clean up on error
        clearTimeout(timeoutId);
        cancellationListener?.dispose();
        this.pendingRenders.delete(requestId);
        reject(error);
      }
    });
  }

  /**
   * Wait for webview to be loaded
   */
  waitForWebview(
    cancellationToken?: vscode.CancellationToken,
    timeout_ms?: number
  ): Promise<void> {
    if (this.disposed) {
      return Promise.reject(new Error('Mermaid renderer disposed'));
    }
    if (this.webviewView && this.webview_ready) {
      return Promise.resolve();
    }
    if (cancellationToken?.isCancellationRequested) {
      return Promise.reject(new vscode.CancellationError());
    }

    return new Promise<void>((resolve, reject) => {
      let cancellation_listener: vscode.Disposable | undefined;
      let timeout_id: NodeJS.Timeout | undefined;
      const cleanup = () => {
        cancellation_listener?.dispose();
        if (timeout_id) {
          clearTimeout(timeout_id);
        }
        this.webview_waiters.delete(waiter);
      };
      const waiter = {
        resolve: () => {
          cleanup();
          resolve();
        },
        reject: (error: Error) => {
          cleanup();
          reject(error);
        },
      };

      this.webview_waiters.add(waiter);
      cancellation_listener = cancellationToken?.onCancellationRequested(() => {
        waiter.reject(new vscode.CancellationError());
      });
      if (cancellationToken?.isCancellationRequested) {
        waiter.reject(new vscode.CancellationError());
        return;
      }
      if (timeout_ms !== undefined) {
        timeout_id = setTimeout(() => {
          waiter.reject(new Error('Mermaid webview readiness timed out'));
        }, timeout_ms);
      }
    });
  }

  /**
   * Dispose and clean up resources
   */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;

    if (this.switch_back_timeout_id) {
      clearTimeout(this.switch_back_timeout_id);
      this.switch_back_timeout_id = undefined;
    }

    for (const waiter of [...this.webview_waiters]) {
      waiter.reject(new Error('Mermaid renderer disposed'));
    }

    // Clear all pending render timeouts and reject promises
    for (const { reject, timeoutId } of this.pendingRenders.values()) {
      clearTimeout(timeoutId);
      reject(new Error('Mermaid renderer disposed'));
    }
    this.pendingRenders.clear();
    
    // Dispose message handler subscription
    this.messageHandlerDisposable?.dispose();
    this.messageHandlerDisposable = undefined;
    
    // Clear webview reference
    this.webviewView = undefined;
    this.webview_ready = false;
    this._extensionContext = undefined;
  }
}

/**
 * Webview view provider for Mermaid rendering
 */
class MermaidWebviewViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'mdInline.mermaidRenderer';

  constructor(private manager: MermaidWebviewManager) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    if (!this.manager.extensionContext) {
      return;
    }
    
    const extensionContext = this.manager.extensionContext;
    
    // Dispose previous message handler if exists (prevent memory leak on webview recreation)
    const previousDisposable = this.manager['messageHandlerDisposable'];
    previousDisposable?.dispose();
    
    // Configure webview to allow access to local assets
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(extensionContext.extensionUri, 'dist', 'mermaid')
      ]
    };
    
    // Store the view and message handler before loading HTML so the ready message cannot be missed.
    this.manager.setWebviewView(webviewView);
    const messageHandlerDisposable = webviewView.webview.onDidReceiveMessage((message) => {
      this.manager.handleWebviewMessage(message);
    }, null, []);
    this.manager.setMessageHandlerDisposable(messageHandlerDisposable);
    webviewView.webview.html = this.manager.getWebviewContent(webviewView.webview, extensionContext.extensionUri);
  }
}
