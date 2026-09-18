const axios = require('axios');
const logger = require('../utils/logger');

async function summarizeJobDescription(jobDescription) {
  try {
    logger.debug('Calling AI service to summarize job description');
    const response = await axios.post(process.env.AI_API_URL, {
      prompt: `Summarize this job description:\n\n${jobDescription}`,
    });

    return response.data;
  } catch (error) {
    logger.error(`AI service error: ${error.message}`);
    throw new Error('Unable to process job description with AI service');
  }
}

module.exports = {
  summarizeJobDescription,
};
