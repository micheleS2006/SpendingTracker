// Compares the rule-based categorizer with the AI categorizer
// on a hand-labeled test set. Run from the backend folder:
//   node eval/evaluate.js
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { getCategory } = require("../rules");
const { categorizeTransactions } = require("../categorizer");
const testSet = require("./labeled.json");

async function main() {
  // 1. Rules
  const rulePredictions = testSet.map(t => getCategory(t.description));

  // 2. AI (one batch call, timed)
  const start = Date.now();
  const aiPredictions = await categorizeTransactions(testSet);
  const seconds = ((Date.now() - start) / 1000).toFixed(1);

  // 3. Score both
  let rulesCorrect = 0;
  let aiCorrect = 0;
  const aiMistakes = [];

  testSet.forEach((t, i) => {
    if (rulePredictions[i] === t.expected) rulesCorrect++;
    if (aiPredictions[i] === t.expected) aiCorrect++;
    else aiMistakes.push(`${t.description}: expected ${t.expected}, AI said ${aiPredictions[i]}`);
  });

  const total = testSet.length;
  const pct = n => Math.round((n / total) * 100);

  console.log("\n=== Evaluation on", total, "labeled transactions ===");
  console.log(`Rules accuracy: ${rulesCorrect}/${total} (${pct(rulesCorrect)}%)`);
  console.log(`AI accuracy:    ${aiCorrect}/${total} (${pct(aiCorrect)}%)`);
  console.log(`AI time:        ${seconds}s for one batch call`);

  console.log("\nSide by side:");
  console.table(testSet.map((t, i) => ({
    description: t.description,
    expected: t.expected,
    rules: rulePredictions[i],
    ai: aiPredictions[i],
  })));

  if (aiMistakes.length) {
    console.log("AI mistakes:");
    aiMistakes.forEach(m => console.log(" -", m));
  } else {
    console.log("AI made no mistakes on this test set.");
  }
}

main();