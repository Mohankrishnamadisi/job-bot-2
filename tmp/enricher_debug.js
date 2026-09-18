const { createJobEnricher } = require('../src/ai');

const calls = [];
const enrichJob = createJobEnricher({
  logger: {
    info() {},
    warn() {},
    error() {},
    debug() {},
  },
  ollamaClient: async (prompt) => {
    if (calls.length === 0) {
      calls.push('first');
      throw new Error('transient AI failure');
    }
    calls.push('second');
    return '{"title":"Senior Engineer","location":"Remote","experience":"3+ years","employment_type":"Full Time","work_mode":"Hybrid","salary":"Competitive Salary","summary":"Build reliable systems.","skills":["Node.js","PostgreSQL"],"description":"A strong professional description.","responsibilities":["Write code","Collaborate with team","Deliver results"],"benefits":["Flexible hours","Career growth"]}';
  },
});

(async () => {
  const job = await enrichJob({
    title: 'Engineer',
    description: null,
    location: null,
    salary: null,
    experience: null,
    employment_type: null,
    work_mode: null,
    summary: null,
    skills: [],
  });
  console.log('calls', calls);
  console.log('job', job);
})();
