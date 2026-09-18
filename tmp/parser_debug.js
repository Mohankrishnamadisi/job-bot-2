const { parseEnrichmentResponse } = require('../src/ai/responseParser');
const raw = '{"title":"Senior\nEngineer","location":"Remote",,"experience":"3+ years",}';
try {
  const parsed = parseEnrichmentResponse(raw);
  console.log('PARSED', parsed);
} catch (error) {
  console.error('ERROR', error.message);
}
