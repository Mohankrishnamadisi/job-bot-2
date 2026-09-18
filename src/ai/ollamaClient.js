'use strict';

const axios = require('axios');
const logger = require('../utils/logger');

const OLLAMA_URL = 'http://localhost:11434/api/generate';
const OLLAMA_MODEL = 'gemma3:4b';
const DEFAULT_OLLAMA_TIMEOUT_MS = 60000;

function getOllamaTimeoutMs(options = {}) {
  const configuredTimeout = Number(process.env.OLLAMA_TIMEOUT || options.timeoutMs || DEFAULT_OLLAMA_TIMEOUT_MS);
  if (!Number.isFinite(configuredTimeout) || configuredTimeout <= 0) {
    return DEFAULT_OLLAMA_TIMEOUT_MS;
  }
  return configuredTimeout;
}

async function callOllama(prompt, options = {}) {
  const timeoutMs = getOllamaTimeoutMs(options);
  const requestBody = {
    model: options.model || OLLAMA_MODEL,
    prompt,
    stream: false,
    options: {
      temperature: 0,
    },
  };

  let lastError;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      logger.debug(`AI started via Ollama (attempt ${attempt}/2)`);
      const response = await axios.post(OLLAMA_URL, requestBody, { timeout: timeoutMs });
      const text = response?.data?.response;

      if (typeof text !== 'string' || text.trim() === '') {
        throw new Error('Ollama returned an empty response');
      }

      logger.debug('AI completed via Ollama');
      return text;
    } catch (error) {
      lastError = error;
      if (attempt === 2) {
        const message = error?.message || 'Unknown Ollama failure';
        logger.warn(`AI failed via Ollama after retry: ${message}`);
        throw new Error(`Ollama request failed: ${message}`);
      }
    }
  }

  throw lastError || new Error('Ollama request failed');
}

module.exports = {
  callOllama,
};
