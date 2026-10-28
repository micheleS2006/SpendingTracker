// A small knowledge base of budgeting strategies.
// The assistant SEARCHES this list (retrieval) before explaining a strategy,
// so its advice comes from content we wrote and checked, not from guessing.
// This is a simple form of RAG: retrieve relevant documents, then generate an answer from them.

const STRATEGIES = [
  {
    id: "50-30-20",
    name: "50/30/20 rule",
    summary: "Split your income: 50% on needs, 30% on wants, 20% on savings and debt.",
    howItWorks: [
      "Needs (50%): rent, groceries, transport, bills, minimum debt payments.",
      "Wants (30%): restaurants, shopping, entertainment, subscriptions.",
      "Savings and extra debt payments (20%): emergency fund, goals, paying debt faster.",
    ],
    goodFor: "Beginners who want a simple rule without tracking every dollar.",
    tip: "If 50% isn't enough for your needs (common for students or in expensive cities), start with 60/30/10 and move toward 50/30/20.",
    keywords: ["simple", "beginner", "split", "percentage", "needs", "wants", "rule", "start", "income"],
  },
  {
    id: "pay-yourself-first",
    name: "Pay yourself first",
    summary: "Move money to savings as soon as you get paid, then live on what's left.",
    howItWorks: [
      "Decide a fixed amount or percentage to save from each paycheck.",
      "Set an automatic transfer to savings on payday, before you spend anything.",
      "Budget the rest of the month with the money that remains.",
    ],
    goodFor: "People who always mean to save 'what's left' but there's never anything left.",
    tip: "Start small, even 5% of each paycheck, and raise it a little every few months.",
    keywords: ["save", "saving", "automatic", "paycheck", "habit", "goal", "first", "automate"],
  },
  {
    id: "zero-based",
    name: "Zero-based budget",
    summary: "Give every dollar of income a job, until income minus planned spending equals zero.",
    howItWorks: [
      "List your income for the month.",
      "Assign every dollar to a category: bills, food, savings, fun, debt.",
      "Keep assigning until nothing is left unplanned, then track against the plan.",
    ],
    goodFor: "Detail-oriented people who want full control of where money goes.",
    tip: "Use the category budgets on the Categories page to set your plan, then compare with 'Planned vs actual'.",
    keywords: ["control", "every dollar", "plan", "detailed", "track", "budget", "categories", "zero"],
  },
  {
    id: "envelope",
    name: "Envelope method",
    summary: "Put a fixed amount in an 'envelope' per category; when it's empty, you stop spending there.",
    howItWorks: [
      "Choose categories that are easy to overspend, like restaurants or shopping.",
      "Set an amount for each one at the start of the month (cash or a separate account).",
      "Spend only from that envelope; when it's empty, wait until next month.",
    ],
    goodFor: "People who overspend in one or two categories.",
    tip: "Digital version: your category budgets work like envelopes, and the progress bars show what's left.",
    keywords: ["overspend", "overspending", "limit", "restaurants", "shopping", "cash", "control", "category", "cut"],
  },
  {
    id: "sinking-funds",
    name: "Sinking funds",
    summary: "Save a little every month for a known future expense, so it never surprises you.",
    howItWorks: [
      "List expenses you know are coming: a trip, a laptop, tuition, gifts, car repairs.",
      "Divide the cost by the number of months left.",
      "Save that amount every month in a separate account or goal.",
    ],
    goodFor: "Planning for goals like a trip or a big purchase without using credit.",
    tip: "Each of your savings goals in My budget can be a sinking fund.",
    keywords: ["goal", "trip", "travel", "future", "purchase", "plan", "save", "big expense", "tuition"],
  },
  {
    id: "emergency-fund",
    name: "Emergency fund first",
    summary: "Build a cushion of 3 to 6 months of expenses before other goals.",
    howItWorks: [
      "Start with a small first target, like $500 to $1,000.",
      "Then grow it to 3 to 6 months of your essential expenses.",
      "Keep it in a separate savings account you can reach quickly but don't use for daily spending.",
    ],
    goodFor: "Anyone without savings, so a surprise bill doesn't turn into debt.",
    tip: "Your average monthly spending (the assistant can calculate it) tells you how big 3 months is.",
    keywords: ["emergency", "safety", "cushion", "unexpected", "surprise", "security", "savings", "start"],
  },
  {
    id: "debt-avalanche",
    name: "Debt avalanche",
    summary: "Pay minimums on all debts, and put every extra dollar on the highest interest rate first.",
    howItWorks: [
      "List your debts with their interest rates.",
      "Pay the minimum on each one.",
      "Put any extra money on the debt with the highest rate; when it's paid, move to the next.",
    ],
    goodFor: "Saving the most money on interest, especially with credit cards.",
    tip: "Credit cards often have the highest rates, so they usually come first.",
    keywords: ["debt", "credit card", "interest", "loan", "pay off", "payoff", "repay"],
  },
  {
    id: "debt-snowball",
    name: "Debt snowball",
    summary: "Pay off your smallest debt first for quick wins, then roll that payment into the next one.",
    howItWorks: [
      "List your debts from smallest to largest balance.",
      "Pay minimums on all, and put extra money on the smallest.",
      "When it's gone, add its payment to the next smallest, like a growing snowball.",
    ],
    goodFor: "Staying motivated when you have several debts.",
    tip: "It can cost a bit more interest than the avalanche, but the quick wins help many people stick with it.",
    keywords: ["debt", "motivation", "small", "loan", "pay off", "payoff", "repay", "afterpay", "klarna"],
  },
  {
    id: "24-hour-rule",
    name: "24-hour rule",
    summary: "Wait 24 hours (or 30 days for big items) before any non-essential purchase.",
    howItWorks: [
      "When you want something that isn't a need, add it to a list instead of buying it.",
      "Come back after 24 hours, or 30 days for expensive items.",
      "Buy it only if you still want it and it fits your budget.",
    ],
    goodFor: "Cutting impulse shopping, especially online.",
    tip: "Removing saved cards from shopping sites adds helpful friction.",
    keywords: ["impulse", "shopping", "online", "cut", "spend less", "wants", "amazon", "reduce"],
  },
  {
    id: "subscription-audit",
    name: "Subscription audit",
    summary: "List every recurring payment and cancel the ones you don't really use.",
    howItWorks: [
      "Look through your statement for recurring charges: streaming, apps, memberships, cloud storage.",
      "For each one, ask: did I use it this month? Would I sign up again today?",
      "Cancel or downgrade what you don't use, and share family plans where possible.",
    ],
    goodFor: "A quick win: small monthly charges add up over a year.",
    tip: "Multiply each subscription by 12 to see its yearly cost.",
    keywords: ["subscription", "recurring", "netflix", "spotify", "cancel", "cut", "streaming", "reduce", "bills"],
  },
  {
    id: "no-spend-challenge",
    name: "No-spend challenge",
    summary: "Pick a period (a weekend, a week, a month) where you only spend on essentials.",
    howItWorks: [
      "Choose the length and what counts as essential (groceries, rent, transport).",
      "Skip everything else: takeout, shopping, coffee out.",
      "Put the money you didn't spend toward a goal.",
    ],
    goodFor: "Resetting habits and finding out what you actually miss.",
    tip: "Start with one no-spend weekend before trying a full week.",
    keywords: ["challenge", "cut", "reset", "habit", "save fast", "restaurants", "coffee", "reduce", "spend less"],
  },
  {
    id: "automate",
    name: "Automate your savings",
    summary: "Set up automatic transfers so saving happens without willpower.",
    howItWorks: [
      "Schedule a transfer to savings the day after each paycheck.",
      "Use round-up features if your bank offers them.",
      "Review the amount every few months and raise it when you can.",
    ],
    goodFor: "Busy people, and anyone who forgets to save.",
    tip: "Pairs well with 'Pay yourself first'.",
    keywords: ["automatic", "automate", "habit", "save", "transfer", "round up", "easy"],
  },
];

// Simple retrieval: score each strategy by how many words of the question
// appear in its name, summary and keywords, and return the best matches.
function searchStrategies(query, limit = 3) {
  const words = String(query || "")
    .toLowerCase()
    .split(/[^a-z0-9àâçéèêëîïôûùüÿ'/-]+/i)
    .filter(w => w.length > 2);

  const scored = STRATEGIES.map(s => {
    const text = `${s.name} ${s.summary} ${s.keywords.join(" ")}`.toLowerCase();
    let score = 0;
    words.forEach(w => { if (text.includes(w)) score += 1; });
    s.keywords.forEach(k => { if (String(query).toLowerCase().includes(k)) score += 2; });
    return { s, score };
  });

  return scored
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(x => x.s);
}

module.exports = { STRATEGIES, searchStrategies };