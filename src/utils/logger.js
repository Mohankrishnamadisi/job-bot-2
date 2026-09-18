const level = require('../config/env').logLevel;

const levels = ['debug', 'info', 'warn', 'error'];
const currentLevelIndex = levels.indexOf(level) >= 0 ? levels.indexOf(level) : 1;

function log(message, severity = 'info') {
  const timestamp = new Date().toISOString();
  if (levels.indexOf(severity) >= currentLevelIndex) {
    console[severity === 'error' ? 'error' : severity === 'warn' ? 'warn' : 'log'](
      `[${timestamp}] [${severity.toUpperCase()}] ${message}`
    );
  }
}

module.exports = {
  debug: (msg) => log(msg, 'debug'),
  info: (msg) => log(msg, 'info'),
  warn: (msg) => log(msg, 'warn'),
  error: (msg) => log(msg, 'error'),
};
