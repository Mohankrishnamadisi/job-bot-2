'use strict';

const Groq = require('groq-sdk');
const logger = require('../utils/logger');

const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-20b';
const DEFAULT_GROQ_TIMEOUT_MS = 60000;
const DEFAULT_GROQ_MAX_TOKENS = 1600;

// Custom error class for quota exhaustion
class GroqQuotaError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GroqQuotaError';
    this.isQuotaError = true;
  }
}

function getGroqModel(options = {}) {
  return process.env.GROQ_MODEL || options.model || DEFAULT_GROQ_MODEL;
}

function getGroqTimeoutMs(options = {}) {
  const configuredTimeout = Number(process.env.GROQ_TIMEOUT || options.timeoutMs || DEFAULT_GROQ_TIMEOUT_MS);
  if (!Number.isFinite(configuredTimeout) || configuredTimeout <= 0) {
    return DEFAULT_GROQ_TIMEOUT_MS;
  }
  return configuredTimeout;
}

function getGroqMaxTokens(options = {}) {
  const configuredMaxTokens = Number(process.env.GROQ_MAX_TOKENS || options.maxTokens || DEFAULT_GROQ_MAX_TOKENS);
  if (!Number.isFinite(configuredMaxTokens) || configuredMaxTokens <= 0) {
    return DEFAULT_GROQ_MAX_TOKENS;
  }
  return configuredMaxTokens;
}

function isQuotaError(error) {
  if (!error) return false;
  const message = (error.message || String(error)).toLowerCase();
  const status = error.status || error.statusCode || 0;
  
  // Check for quota-related patterns
  if (/insufficient_quota|quota.*exceed|quota.*limit/i.test(message)) {
    return true;
  }
  
  // HTTP 429 (rate limit) or 402 (payment required) or similar
  if (status === 429 || status === 402 || status === 400) {
    if (/rate|limit|quota|retry|too many/i.test(message)) {
      return true;
    }
  }
  
  return false;
}

function isTemporaryError(error) {
  if (!error) return false;
  const message = (error.message || String(error)).toLowerCase();
  const status = error.status || error.statusCode || 0;
  
  // Timeouts and temporary server errors
  if (/timeout|econnrefused|enotfound|temporarily unavailable|try again|service unavailable/i.test(message)) {
    return true;
  }
  
  // HTTP 5xx errors (server errors, usually temporary)
  if (status >= 500 && status < 600) {
    return true;
  }
  
  // HTTP 408 (request timeout), 429 (rate limit) - but not if it's quota exhaustion
  if ((status === 408 || status === 429) && !isQuotaError(error)) {
    return true;
  }
  
  return false;
}

async function callGroq(prompt, options = {}) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error('GROQ_API_KEY environment variable is not set');
  }

  const model = getGroqModel(options);
  const timeoutMs = getGroqTimeoutMs(options);
  const deadline = Date.now() + timeoutMs;
  let lastError;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      logger.debug(`AI started via Groq (attempt ${attempt}/2)`);

      const remainingTimeoutMs = Math.max(1, deadline - Date.now());
      const client = new Groq({ apiKey, timeout: remainingTimeoutMs });

      const message = await client.chat.completions.create({
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
        model,
        temperature: 0.1,
        max_tokens: getGroqMaxTokens(options),
        reasoning_format: 'hidden',
      });

      const text = message.choices[0]?.message?.content;

      if (typeof text !== 'string' || text.trim() === '') {
        // Empty response - treat as temporary error (might be quota)
        throw new Error('Groq returned an empty response');
      }

      logger.debug('AI completed via Groq');
      return text;
    } catch (error) {
      lastError = error;
      
      // Check if it's a quota error
      if (isQuotaError(error)) {
        const message = error?.message || 'Quota exhausted';
        logger.error(`╔════════════════════════════════════════════════════════════════╗`);
        logger.error(`║ GROQ QUOTA EXHAUSTED - AI REQUESTS WILL FAIL ║`);
        logger.error(`╠════════════════════════════════════════════════════════════════╣`);
        logger.error(`║ ${message.substring(0, 60)}`);
        logger.error(`╚════════════════════════════════════════════════════════════════╝`);
        
        // Throw immediately without retrying
        throw new GroqQuotaError(`Groq quota exhausted: ${message}`);
      }

      if (Date.now() >= deadline || /timeout|aborted/i.test(error?.message || '')) {
        const timeoutError = new Error(`Groq request timed out after ${timeoutMs}ms`);
        timeoutError.isAiTimeout = true;
        throw timeoutError;
      }
      
      // Check if it's a temporary error
      if (isTemporaryError(error)) {
        if (attempt === 1) {
          logger.warn(`Temporary Groq error on attempt 1, will retry: ${error?.message || String(error)}`);
          // Continue to attempt 2
          continue;
        }
        // On attempt 2, fall through to throw
      }
      
      // On last attempt, throw
      if (attempt === 2) {
        const message = error?.message || 'Unknown Groq failure';
        logger.warn(`AI failed via Groq after retry: ${message}`);
        throw new Error(`Groq request failed: ${message}`);
      }
    }
  }

  throw lastError || new Error('Groq request failed');
}

module.exports = {
  callGroq,
  GroqQuotaError,
};
