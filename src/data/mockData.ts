// mockData.js — Shared academic data: notes, recordings, previous work, drafts.
// Import from here in both Toolkit and Assignment so both see the same corpus.
// Replace with real Canvas API data when auth is wired.

export const CLASS_NOTES = [
  {
    id: 1,
    course: "PSYC 302",
    title: "Lecture 7: Working Memory Models",
    date: "May 15, 2026",
    tags: ["memory", "cognition", "Baddeley"],
    content:
      "Working memory has four components: phonological loop, visuospatial sketchpad, episodic buffer, and central executive (Baddeley & Hitch, 1974). Capacity ≈ 7±2 chunks (Miller, 1956); modern estimates suggest 4±1 items when chunking is controlled (Cowan, 2001). Intrinsic load is fixed by material complexity; extraneous load is imposed by poor instructional design and must be minimised.",
    wordCount: 420,
  },
  {
    id: 2,
    course: "CS 355",
    title: "Lecture 12: Dynamic Programming",
    date: "May 17, 2026",
    tags: ["algorithms", "DP", "memoization"],
    content:
      "Dynamic programming requires optimal substructure + overlapping subproblems. Top-down (memoization) caches recursive calls; bottom-up (tabulation) fills a table iteratively. Reduces time complexity from O(2^n) to O(n^2) for many problems. Classic examples: Fibonacci, LCS, edit distance, 0/1 knapsack. Key insight: DP trades space for time by storing sub-solutions.",
    wordCount: 380,
  },
  {
    id: 3,
    course: "BUS 410",
    title: "Porter's Five Forces — Case Analysis",
    date: "May 14, 2026",
    tags: ["strategy", "Porter", "competition"],
    content:
      "Porter's Five Forces: threat of new entrants, supplier power, buyer power, substitutes, rivalry intensity. iPhone (2007): low initial supplier power, high ecosystem switching costs, Android threat emerged post-2010. Platform ecosystems convert weak forces into structural advantages via network effects and lock-in. Strategic implication: compete for platform, not product.",
    wordCount: 510,
  },
  {
    id: 4,
    course: "MATH 241",
    title: "First-Order Linear ODEs",
    date: "May 13, 2026",
    tags: ["ODEs", "linear", "integrating factor"],
    content:
      "Standard form: dy/dx + P(x)y = Q(x). Integrating factor μ(x) = e^∫P(x)dx. Solution: y = (1/μ)[∫μQ(x)dx + C]. Applications: RC circuits (V_c(t)), mixing problems, Newton's law of cooling, population growth with harvesting. Always check P(x) continuity on interval of interest.",
    wordCount: 290,
  },
];

export const LECTURE_RECORDINGS = [
  { id: 1, course: "PSYC 302", title: "Cognitive Load Theory in Practice",    date: "May 16, 2026", duration: "52:14", size: "124 MB" },
  { id: 2, course: "MATH 241", title: "Boundary Value Problems",               date: "May 15, 2026", duration: "48:30", size: "112 MB" },
  { id: 3, course: "CS 355",   title: "Graph Algorithms — BFS & DFS",         date: "May 14, 2026", duration: "61:05", size: "148 MB" },
  { id: 4, course: "BUS 410",  title: "Competitive Advantage Frameworks",     date: "May 13, 2026", duration: "44:20", size: "102 MB" },
  { id: 5, course: "PSYC 302", title: "Attention & Distraction Research",     date: "May 12, 2026", duration: "55:40", size: "132 MB" },
];

export const PREVIOUS_WORK = [
  {
    id: 1,
    title: "How Social Media Disrupts Cognitive Processing",
    course: "PSYC 302",
    grade: "A",
    date: "April 28, 2026",
    wordCount: 1820,
    excerpt:
      "Digital environments present unprecedented cognitive challenges. Drawing from Sweller's (1988) cognitive load theory, this paper argues that social media interfaces maximize extraneous cognitive load, undermining deep learning and long-term retention through constant context-switching and parasocial reward loops.",
  },
  {
    id: 2,
    title: "Competitive Analysis: Streaming Industry 2025",
    course: "BUS 410",
    grade: "A−",
    date: "April 21, 2026",
    wordCount: 1240,
    excerpt:
      "Applying Porter's Five Forces to the streaming industry reveals consolidated supplier power among major content studios, while substitute threats from short-form video platforms intensify competitive rivalry. Network effects have become the dominant strategic moat, redefining what constitutes a sustainable competitive advantage.",
  },
  {
    id: 3,
    title: "Divide and Conquer Algorithm Design Patterns",
    course: "CS 355",
    grade: "B+",
    date: "April 14, 2026",
    wordCount: 950,
    excerpt:
      "Divide and conquer algorithms partition problems into independent subproblems, solve each recursively, and combine solutions. Analysis using recurrence relations and the Master Theorem provides systematic time complexity derivation. Empirical benchmarks validate theoretical predictions across sorting, searching, and matrix multiplication variants.",
  },
];

export const SAVED_DRAFTS = [
  { id: 1, title: "Cognitive Load Theory — Draft 2", timestamp: "2 hours ago", words: 1240 },
  { id: 2, title: "Market Entry Strategy Outline",   timestamp: "Yesterday",   words:  620 },
  { id: 3, title: "Algorithm Analysis Notes",        timestamp: "3 days ago",  words:  890 },
];

// Builds a rich context string injected into the AI system prompt when generating assignments.
// The AI uses the student's actual class notes and prior work to match content, voice, and style.
export function buildStudentContext() {
  const notes = CLASS_NOTES
    .map((n) => `[${n.course} — ${n.title}]\n${n.content}`)
    .join("\n\n");

  const prev = PREVIOUS_WORK
    .map((w) => `[${w.course} | Grade: ${w.grade}] "${w.title}"\n${w.excerpt}`)
    .join("\n\n");

  return (
    "STUDENT'S CLASS NOTES (use for content accuracy and terminology):\n" +
    notes +
    "\n\n" +
    "STUDENT'S PREVIOUS WORK (mirror this academic voice, sentence rhythm, and register):\n" +
    prev
  );
}
