export function branchIdsForCourse(course) {
  const embedded = course?.course_branch_visibility || course?.branch_visibility || [];
  const mapped = Array.isArray(embedded) ? embedded.map((row) => row.branch_id) : [];
  return [...new Set([...mapped, ...(course?.branch_id ? [course.branch_id] : [])].filter(Boolean).map(String))];
}

export function courseVisibleToBranch(course, branchId) {
  return Boolean(branchId && branchIdsForCourse(course).includes(String(branchId)));
}

export function visibleCoursesForWorkspace(courses, { role, userId, branchId } = {}) {
  const seen = new Set();
  return courses.filter((course) => {
    const key = String(course.id);
    if (seen.has(key)) return false;
    const visible = role === "super_admin" || role === "teacher"
      || (course.owner_id && String(course.owner_id) === String(userId))
      || courseVisibleToBranch(course, branchId);
    if (visible) seen.add(key);
    return visible;
  });
}

export function visibleMaterialsForWorkspace(materials, courses, { role, userId, branchId } = {}) {
  if (role === "super_admin") return materials;
  const courseIds = new Set(courses.filter((course) => role === "teacher"
    ? branchIdsForCourse(course).length > 0
    : courseVisibleToBranch(course, branchId)).map((course) => String(course.id)));
  return materials.filter((material) => {
    const ownerId = material.userId || material.user_id;
    if (String(ownerId || "") === String(userId || "")) return true;
    const courseId = material.courseId || material.course_id;
    return material.isShared === true && courseId && courseIds.has(String(courseId));
  });
}
