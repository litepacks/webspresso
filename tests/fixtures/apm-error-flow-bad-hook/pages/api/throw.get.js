module.exports = async function throwApi() {
  throw new Error('api-before-onError-throw');
};
