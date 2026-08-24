module.exports = async function simpleService(input, ctx) {
  return { simple: true, echo: input, hasDb: !!ctx.db };
};
