import { bootClient, defineClientService, type InferClientServicesMap } from '../../core/client';
import todosController from './pages/todos.client';
import quickShareController from './components/quick-share.client';

export const services = {
  toast: defineClientService({
    load: () => import('./services/toast'),
  }),
  clipboard: defineClientService({
    load: () => import('./services/clipboard'),
  }),
};

declare module '../../index' {
  interface AppClientServices extends InferClientServicesMap<typeof services> {}
}

export function startExampleClient(options: Record<string, unknown> = {}) {
  return bootClient({
    debug: true,
    services,
    controllers: {
      todos: todosController,
      'quick-share': quickShareController,
    },
    ...options,
  });
}

if (typeof document !== 'undefined') {
  startExampleClient();
}
