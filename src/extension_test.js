import fs from 'node:fs';
import vm from 'node:vm';
import { describe, it, expect, vi } from 'vitest';

function load_extension(enabled) {
  let config_listener;
  const stop_renderer = vi.fn();
  const inline_api = { decorator: {} };
  const inline_extension = {
    activate: vi.fn(context => {
      context.subscriptions.push({ dispose: stop_renderer });
      return inline_api;
    }),
    deactivate: vi.fn(),
  };
  const custom_module = { register: vi.fn(), dispose: vi.fn() };
  const load_inline = vi.fn(() => inline_extension);
  const module = { exports: {} };
  const vscode = { workspace: {
    getConfiguration: () => ({ get: () => enabled }),
    onDidChangeConfiguration: listener => {
      config_listener = listener;
      return { dispose() {} };
    },
  } };
  vm.runInNewContext(fs.readFileSync(new URL('./extension.js', import.meta.url), 'utf8'), {
    module,
    require: name => name === 'vscode' ? vscode : name === './inline/extension' ? load_inline() : custom_module,
  });
  const context = { subscriptions: [], extensionUri: 'extension-root' };
  Object.defineProperty(context, 'extensionRuntime', {
    enumerable: true,
    get() { throw new Error('Proposed API is unavailable'); },
  });
  const api = module.exports.activate(context);
  return {
    api, context, inline_extension, custom_module, load_inline, stop_renderer,
    set_enabled(value) {
      enabled = value;
      config_listener({ affectsConfiguration: key => key === 'nnyjEditorStyling.inline.enabled' });
    },
  };
}

describe('combined extension lifecycle', () => {
  it('keeps custom styling active while unloading and restarting inline rendering', () => {
    const extension = load_extension(true);
    expect(extension.api.inline).toBeDefined();
    expect(extension.custom_module.register).toHaveBeenCalledTimes(2);
    extension.set_enabled(false);
    expect(extension.api.inline).toBeUndefined();
    expect(extension.stop_renderer).toHaveBeenCalledOnce();
    expect(extension.custom_module.dispose).not.toHaveBeenCalled();
    extension.set_enabled(true);
    expect(extension.api.inline).toBeDefined();
    expect(extension.inline_extension.activate).toHaveBeenCalledTimes(2);
    expect(extension.load_inline).toHaveBeenCalledOnce();
    for (const subscription of extension.context.subscriptions) subscription.dispose();
    expect(extension.stop_renderer).toHaveBeenCalledTimes(2);
  });

  it('does not load renderer dependencies when initially disabled', () => {
    const extension = load_extension(false);
    expect(extension.load_inline).not.toHaveBeenCalled();
    extension.set_enabled(true);
    expect(extension.load_inline).toHaveBeenCalledOnce();
  });
});
