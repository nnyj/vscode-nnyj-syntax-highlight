import type { TextDocument } from 'vscode';

export class DecoratorUpdateScheduler {
  private updateTimeout: NodeJS.Timeout | undefined;
  private readonly pendingUpdateVersion = new Map<string, number>();

  constructor(private readonly debounceTimeoutMs: number) {}

  schedule(document: TextDocument, callback: () => void): void {
    const cacheKey = document.uri.toString();
    this.pendingUpdateVersion.set(cacheKey, document.version);
    this.cancel();

    this.updateTimeout = setTimeout(() => {
      this.updateTimeout = undefined;
      const scheduledVersion = this.pendingUpdateVersion.get(cacheKey);
      if (scheduledVersion !== document.version) {
        return;
      }
      callback();
      this.pendingUpdateVersion.delete(cacheKey);
    }, this.debounceTimeoutMs);
  }

  cancel(): void {
    if (this.updateTimeout) {
      clearTimeout(this.updateTimeout);
      this.updateTimeout = undefined;
    }
  }

  dispose(): void {
    this.cancel();
    this.pendingUpdateVersion.clear();
  }
}
