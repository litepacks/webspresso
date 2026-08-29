module.exports = {
  async load({ req }) {
    return {
      greeting: 'Welcome to Webspresso SSR!',
      serverTime: new Date().toUTCString(),
      meta: {
        title: 'Home — Webspresso Starter',
        description: 'A minimal server-rendered starter template.',
      },
    };
  },
};
