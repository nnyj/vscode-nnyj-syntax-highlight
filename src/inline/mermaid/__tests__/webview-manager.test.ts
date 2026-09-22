import { vi } from 'vitest';

const vscode_mocks = vi.hoisted(() => ({
  execute_command: vi.fn(),
  register_webview_provider: vi.fn(),
  output_channel_dispose: vi.fn(),
}));

vi.mock('vscode', () => ({
  CancellationError: class CancellationError extends Error {},
  ColorThemeKind: { Dark: 2, HighContrast: 3 },
  Uri: {
    joinPath: (base: { toString(): string }, ...parts: string[]) => ({
      toString: () => [base.toString(), ...parts].join('/'),
    }),
  },
  commands: { executeCommand: vscode_mocks.execute_command },
  window: {
    activeColorTheme: { kind: 2 },
    createOutputChannel: () => ({
      appendLine: vi.fn(),
      dispose: vscode_mocks.output_channel_dispose,
    }),
    registerWebviewViewProvider: vscode_mocks.register_webview_provider,
  },
  workspace: {
    getConfiguration: () => ({
      get: (_key: string, default_value: unknown) => default_value,
    }),
  },
}));

import * as vscode from 'vscode';
import {
  disposeMermaidRenderer,
  initMermaidRenderer,
  renderMermaidSvgNatural,
} from '../mermaid-renderer';
import { MermaidWebviewManager } from '../webview-manager';

function create_context(): vscode.ExtensionContext {
  return {
    extensionUri: { toString: () => 'file:///extension' },
    subscriptions: [],
  } as unknown as vscode.ExtensionContext;
}

function create_cancellation(): {
  token: vscode.CancellationToken;
  cancel: () => void;
} {
  let cancelled = false;
  const listeners = new Set<() => void>();
  const token = {
    get isCancellationRequested() {
      return cancelled;
    },
    onCancellationRequested(listener: () => void) {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
  } as vscode.CancellationToken;

  return {
    token,
    cancel: () => {
      cancelled = true;
      for (const listener of [...listeners]) {
        listener();
      }
    },
  };
}

async function flush_promises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('Mermaid webview lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vscode_mocks.execute_command.mockReset().mockResolvedValue(undefined);
    vscode_mocks.register_webview_provider.mockReset().mockReturnValue({ dispose: vi.fn() });
    disposeMermaidRenderer();
  });

  afterEach(() => {
    disposeMermaidRenderer();
    vi.useRealTimers();
  });

  it('cancels a readiness wait before the webview exists', async () => {
    const manager = new MermaidWebviewManager();
    const cancellation = create_cancellation();
    const result = expect(manager.waitForWebview(cancellation.token)).rejects.toBeInstanceOf(
      vscode.CancellationError
    );

    cancellation.cancel();

    await result;
    manager.dispose();
  });

  it('waits for the webview ready message before allowing renders', async () => {
    const manager = new MermaidWebviewManager();
    let settled = false;
    const result = manager.waitForWebview().then(() => {
      settled = true;
    });

    manager.setWebviewView({} as vscode.WebviewView);
    await flush_promises();
    expect(settled).toBe(false);

    manager.handleWebviewMessage({ ready: true });
    await result;
    expect(settled).toBe(true);
    manager.dispose();
  });

  it('rejects readiness waits and clears focus timers on disposal', async () => {
    const manager = new MermaidWebviewManager();
    manager.initialize(create_context());
    await flush_promises();
    const result = expect(manager.waitForWebview()).rejects.toThrow('Mermaid renderer disposed');

    manager.dispose();
    await result;
    await flush_promises();
    await vi.advanceTimersByTimeAsync(6000);

    expect(vscode_mocks.execute_command).toHaveBeenCalledTimes(1);
    expect(vscode_mocks.execute_command).toHaveBeenCalledWith('mdInline.mermaidRenderer.focus');
  });

  it('stops a hover render waiting for readiness when its token is cancelled', async () => {
    initMermaidRenderer(create_context());
    await flush_promises();
    const cancellation = create_cancellation();
    const result = expect(
      renderMermaidSvgNatural('graph TD; A-->B', { theme: 'default' }, cancellation.token)
    ).rejects.toBeInstanceOf(vscode.CancellationError);

    cancellation.cancel();

    await result;
  });

  it('stops readiness work without switching views when the renderer is disposed', async () => {
    initMermaidRenderer(create_context());
    await flush_promises();
    const result = expect(
      renderMermaidSvgNatural('graph TD; A-->B', { theme: 'default' })
    ).rejects.toThrow('Mermaid renderer disposed');

    disposeMermaidRenderer();
    await result;
    await flush_promises();
    await vi.advanceTimersByTimeAsync(6000);

    expect(vscode_mocks.execute_command).toHaveBeenCalledTimes(1);
    expect(vscode_mocks.execute_command).toHaveBeenCalledWith('mdInline.mermaidRenderer.focus');
  });
});
