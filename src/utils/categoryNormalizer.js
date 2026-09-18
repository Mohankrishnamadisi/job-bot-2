'use strict';

const CATEGORY_RULES = [
  { category: 'Software Development', patterns: ['react', 'vue', 'frontend', 'frontend engineer', 'backend', 'full stack', 'full-stack', 'developer', 'software engineer', 'engineering', 'web developer', 'node', 'javascript', 'typescript', 'java', 'python', 'php', 'dotnet', 'c#', 'c++', 'golang', 'ruby', 'rust', 'go', 'api', 'microservices', 'system design', 'application development'] },
  { category: 'Artificial Intelligence', patterns: ['ai engineer', 'artificial intelligence', 'ai', 'machine learning engineer', 'llm', 'generative ai', 'prompt engineer', 'computer vision', 'nlp'] },
  { category: 'Machine Learning', patterns: ['machine learning', 'ml engineer', 'mlops', 'deep learning', 'reinforcement learning', 'predictive modeling'] },
  { category: 'Data Science', patterns: ['data scientist', 'data science', 'scientist'] },
  { category: 'Data Analytics', patterns: ['data analyst', 'analytics', 'business intelligence', 'bi analyst', 'dashboard'] },
  { category: 'DevOps', patterns: ['devops', 'sre', 'site reliability', 'infrastructure', 'platform engineer', 'ci/cd', 'deployment automation'] },
  { category: 'Cloud Computing', patterns: ['cloud', 'aws', 'azure', 'gcp', 'cloud engineer', 'cloud architect'] },
  { category: 'Cyber Security', patterns: ['cyber security', 'security analyst', 'security engineer', 'pentest', 'penetration testing', 'soc analyst', 'information security'] },
  { category: 'Quality Assurance', patterns: ['qa', 'quality assurance', 'tester', 'test engineer', 'automation tester', 'manual tester', 'software testing'] },
  { category: 'UI/UX Design', patterns: ['ui designer', 'ux designer', 'user interface', 'user experience', 'figma', 'product design', 'design systems'] },
  { category: 'Mobile Development', patterns: ['android', 'ios', 'mobile developer', 'mobile engineer', 'flutter', 'react native', 'swift', 'kotlin'] },
  { category: 'Project Management', patterns: ['project manager', 'project management', 'delivery manager', 'program manager'] },
  { category: 'Product Management', patterns: ['product manager', 'product management', 'product owner', 'product operations'] },
  { category: 'Business Analysis', patterns: ['business analyst', 'business analysis', 'requirements analyst', 'process analyst'] },
  { category: 'Human Resources', patterns: ['hr', 'human resources', 'recruiter', 'talent acquisition', 'people operations'] },
  { category: 'Sales', patterns: ['sales', 'business development', 'account executive', 'sales executive'] },
  { category: 'Marketing', patterns: ['marketing', 'seo', 'content marketing', 'digital marketing', 'growth marketing'] },
  { category: 'Finance', patterns: ['financial analyst', 'finance', 'investment', 'treasury', 'fp&a'] },
  { category: 'Accounting', patterns: ['accountant', 'accounting', 'accounts payable', 'accounts receivable'] },
  { category: 'Customer Support', patterns: ['customer support', 'customer success', 'support executive', 'support engineer'] },
  { category: 'Technical Support', patterns: ['technical support', 'support engineer', 'help desk'] },
  { category: 'Networking', patterns: ['network engineer', 'networking', 'network administrator', 'ccna', 'ccnp'] },
  { category: 'Database Administration', patterns: ['database administrator', 'db administrator', 'sql administrator', 'database engineer'] },
  { category: 'Content Writing', patterns: ['content writer', 'technical writer', 'copywriter', 'editor'] },
  { category: 'Operations', patterns: ['operations', 'operations executive', 'operations manager', 'supply chain'] },
  { category: 'Legal', patterns: ['legal', 'law', 'paralegal', 'legal advisor'] },
  { category: 'Healthcare', patterns: ['nurse', 'healthcare', 'medical', 'pharmacist'] },
  { category: 'Education', patterns: ['teacher', 'education', 'trainer', 'faculty'] },
  { category: 'Engineering', patterns: ['mechanical engineer', 'civil engineer', 'electrical engineer', 'engineering'] },
  { category: 'Internship', patterns: ['intern', 'internship'] },
];

function normalizeText(value) {
  if (value == null) {
    return '';
  }
  if (typeof value === 'string') {
    return value.trim().toLowerCase();
  }
  return String(value).trim().toLowerCase();
}

function buildSearchText(job) {
  const parts = [];
  if (job?.title) parts.push(String(job.title));
  if (Array.isArray(job?.skills)) parts.push(job.skills.join(' '));
  if (job?.summary) parts.push(String(job.summary));
  if (job?.description) parts.push(String(job.description));
  return normalizeText(parts.join(' '));
}

function generateCategory(job) {
  const searchText = buildSearchText(job);
  if (!searchText) {
    return 'Other';
  }

  let bestCategory = 'Other';
  let bestScore = 0;

  for (const rule of CATEGORY_RULES) {
    let score = 0;
    for (const pattern of rule.patterns) {
      if (searchText.includes(pattern)) {
        score += 1;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestCategory = rule.category;
    }
  }

  return bestScore > 0 ? bestCategory : 'Other';
}

module.exports = {
  generateCategory,
  CATEGORY_RULES,
};
