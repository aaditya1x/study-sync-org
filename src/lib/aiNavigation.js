const DESTINATIONS = [
  { id: "Syllabus", label: "Curriculum", pattern: /syllabus|curriculum|chapter|unit|topic|subtopic/i },
  { id: "Materials", label: "Study Materials", pattern: /study material|notes|uploaded file/i },
  { id: "Previous Year Questions", label: "Previous Year Questions", pattern: /previous.year|\bpyq\b|past paper/i },
  { id: "Mock Tests", label: "Mock Tests", pattern: /mock test|practice test|practice question/i },
  { id: "Tasks", label: "Assignments", pattern: /assignment|deadline|task|to.do/i },
  { id: "Progress", label: "Progress Reports", pattern: /progress|completion|completed topics|study performance/i },
  { id: "Courses", label: "Courses", pattern: /course|subject|class/i },
  { id: "Dashboard", label: "Dashboard", pattern: /dashboard|overview/i },
];

export function suggestedAISection(text = "") {
  if (typeof text !== "string") return null;
  return DESTINATIONS.find(({ pattern }) => pattern.test(text)) || null;
}

export function isAllowedAINavigation(section) {
  return DESTINATIONS.some(({ id }) => id === section);
}
