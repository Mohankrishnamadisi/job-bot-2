const fetch = global.fetch;

async function testOllama() {
  const prompt = `
Extract the following information from this job description.

Return ONLY valid JSON.

Job Description:

Senior React Developer

We are looking for an experienced React Developer.

Experience: 5+ years

Skills:
React
TypeScript
Redux
Node.js

Location:
Hyderabad

Employment Type:
Full Time

Salary:
18-25 LPA

Responsibilities include developing scalable web applications.

Return JSON like this:

{
"title":"",
"skills":[],
"experience_min":0,
"experience_max":0,
"salary_min":0,
"salary_max":0,
"currency":"",
"employment_type":"",
"workplace_type":"",
"city":"",
"country":"",
"summary":""
}
`;

  const response = await fetch("http://localhost:11434/api/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gemma3:4b",
      prompt,
      stream: false,
    }),
  });

  const data = await response.json();

  console.log(data.response);
}

testOllama();