export function validateAcademicProfile({
  degreeId,
  branchId,
  degrees = [],
  branches = [],
}) {
  if (!degreeId) return "Choose a degree and a branch to continue.";

  if (!degrees.some((degree) => degree.id === degreeId)) {
    return "Choose a valid degree from the available options.";
  }

  if (!branchId) return "Choose a degree and a branch to continue.";

  const branch = branches.find((option) => option.id === branchId);
  if (!branch || branch.degree_id !== degreeId) {
    return "Choose a branch that belongs to the selected degree.";
  }

  return null;
}
