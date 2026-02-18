const isNode = (typeof require !== 'undefined') && (typeof process !== 'undefined') && !!(process.versions && process.versions.node);

function _getGlobal(pathStr) {
  // safe walker for e.g. "SnakeAI.Config"
  return pathStr.split('.').reduce((obj, key) => (obj && obj[key] !== undefined) ? obj[key] : undefined, globalThis);
}

function requireOrGlobal(modulePath, globalPath) {
  if (isNode) return require(modulePath);
  return _getGlobal(globalPath);
}

module.exports = { isNode, requireOrGlobal };
