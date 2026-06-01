export function filterVisibleSessions(sessions, showEmptySessions) {
  if (!Array.isArray(sessions)) {
    return [];
  }

  return sessions.filter(function (session) {
    return showEmptySessions || session?.isEmpty !== true;
  });
}
