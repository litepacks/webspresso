import { defineClientService } from '../../../core/client';

export interface ToastItem {
  id: string;
  message: string;
}

export interface ToastService {
  success(message: string): string;
  dismiss(id?: string): void;
  count(): number;
}

let toastSeq = 0;

export default defineClientService<ToastService>({
  create({ mountHost, onCleanup }) {
    const host = mountHost('toast', {
      className: 'demo-toast-host',
      attributes: {
        role: 'status',
        'aria-live': 'polite',
      },
    });

    const items = new Map<string, HTMLElement>();

    function dismiss(id?: string) {
      if (!id) {
        for (const el of items.values()) {
          if (el.parentNode) el.parentNode.removeChild(el);
        }
        items.clear();
        return;
      }
      const target = items.get(id);
      if (target) {
        if (target.parentNode) target.parentNode.removeChild(target);
        items.delete(id);
      }
    }

    function success(message: string): string {
      const id = `toast_${++toastSeq}`;
      const doc = host.el.ownerDocument || document;
      const itemEl = doc.createElement('div');
      itemEl.className = 'demo-toast-item';
      itemEl.setAttribute('data-toast-id', id);
      itemEl.textContent = String(message || '');
      if (typeof itemEl.addEventListener === 'function') {
        itemEl.addEventListener('click', () => dismiss(id));
      }
      host.el.appendChild(itemEl);
      items.set(id, itemEl);
      return id;
    }

    onCleanup(() => {
      items.clear();
    });

    return {
      success,
      dismiss,
      count: () => items.size,
    };
  },
});

