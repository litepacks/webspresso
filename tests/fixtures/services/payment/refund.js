module.exports = {
  schema: {
    transactionId: 'string',
    amount: 'number',
  },
  async handler({ transactionId, amount }, ctx) {
    return {
      refundId: 'ref_123',
      transactionId,
      amount,
      status: 'succeeded',
    };
  },
};
