export function syllabusSourcesForCourse(sources, courseId) {
  if (typeof courseId !== "string" || !courseId || !Array.isArray(sources)) return [];
  return sources.filter((source) => source?.course_id === courseId);
}

export function sourceMatchesSelectedCourse(source, courseId) {
  return typeof courseId === "string" && Boolean(courseId) && source?.course_id === courseId;
}
