'use strict';

const { enrichJobWithOllama, enrichJobWithGroq } = require('./jobExtractor');

function selectAIProvider(dependencies = {}) {
  if (dependencies.provider) {
    const requestedProvider = String(dependencies.provider).toLowerCase().trim();
    return requestedProvider === 'groq' ? 'groq' : 'ollama';
  }

  if (dependencies.ollamaClient && !dependencies.groqClient) {
    return 'ollama';
  }

  if (dependencies.groqClient && !dependencies.ollamaClient) {
    return 'groq';
  }

  const envProvider = (process.env.AI_PROVIDER || '').toLowerCase().trim();
  if (envProvider === 'groq') {
    return 'groq';
  }
  if (envProvider === 'ollama') {
    return 'ollama';
  }

  if (process.env.GROQ_API_KEY) {
    return 'groq';
  }

  if (process.env.OLLAMA_MODEL) {
    return 'ollama';
  }

  return 'ollama';
}

function createJobEnricher(dependencies = {}) {
  const provider = selectAIProvider(dependencies);
  const enrichmentFunction = provider === 'groq' ? enrichJobWithGroq : enrichJobWithOllama;

  return async function enrichJob(job, runtimeDependencies = {}) {
    return enrichmentFunction(job, { ...dependencies, ...runtimeDependencies });
  };
}

module.exports = {
  createJobEnricher,
  enrichJobWithOllama,
  enrichJobWithGroq,
  selectAIProvider,
};
