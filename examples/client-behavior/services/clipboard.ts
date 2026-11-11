import { defineClientService } from '../../../core/client';

export interface ClipboardService {
  copy(text: string): Promise<boolean>;
  lastCopied(): string | null;
}

export default defineClientService<ClipboardService>({
  create({ onCleanup }) {
    let lastValue: string | null = null;

    async function copy(text: string): Promise<boolean> {
      const value = String(text ?? '');
      lastValue = value;
      if (
        typeof navigator !== 'undefined' &&
        navigator.clipboard &&
        typeof navigator.clipboard.writeText === 'function'
      ) {
        try {
          await navigator.clipboard.writeText(value);
        } catch (_e) {
          // Fallback retains in-memory lastValue in headless/non-HTTPS environments
        }
      }
      return true;
    }

    onCleanup(() => {
      lastValue = null;
    });

    return {
      copy,
      lastCopied: () => lastValue,
    };
  },
});

