module.exports = {
  async handler(input, ctx) {
    return {
      reportType: input.type || 'summary',
      generated: true,
      serviceName: 'report.generate',
    };
  },
};
