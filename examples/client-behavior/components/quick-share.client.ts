import { defineController } from '../../../core/client';

export default defineController({
  name: 'quick-share',
  state: () => ({
    copiedCount: 0,
  }),
  actions: {
    async sharePage({ state, services }, _event, actionEl) {
      const label = actionEl?.data<string>('share-text') || 'Task & Engineering Backlog';
      const clipboard = await services.get('clipboard');
      await clipboard.copy(label);
      state.copiedCount += 1;

      const toast = await services.get('toast');
      toast.success(`Copied: ${label}`);
    },
  },
});

