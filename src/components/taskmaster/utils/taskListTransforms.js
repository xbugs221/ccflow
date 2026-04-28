/**
 * PURPOSE: Keep TaskMaster list filtering and sorting rules outside the large
 * view component so task workflow behavior is easier to test and review.
 */

/**
 * Collect stable sorted filter options from a task field.
 *
 * @param {Array<Record<string, unknown>>} tasks - TaskMaster task records.
 * @param {string} field - Task field to collect.
 * @returns {unknown[]} Sorted unique values for the filter dropdown.
 */
export function getSortedTaskFilterValues(tasks, field) {
  const values = new Set(tasks.map((task) => task[field]).filter(Boolean));
  return Array.from(values).sort();
}

/**
 * Filter and sort TaskMaster tasks using the same workflow fields shown in UI.
 *
 * @param {Array<Record<string, unknown>>} tasks - TaskMaster task records.
 * @param {{ searchTerm: string, statusFilter: string, priorityFilter: string, sortBy: string, sortOrder: string }} options
 * @returns {Array<Record<string, unknown>>} Filtered and sorted task records.
 */
export function filterAndSortTasks(tasks, options) {
  const {
    searchTerm = '',
    statusFilter = 'all',
    priorityFilter = 'all',
    sortBy = 'id',
    sortOrder = 'asc',
  } = options;
  const searchLower = searchTerm.toLowerCase();

  const filtered = tasks.filter((task) => {
    const title = String(task.title || '').toLowerCase();
    const description = String(task.description || '').toLowerCase();
    const taskId = String(task.id || '').toLowerCase();
    const matchesSearch = !searchTerm
      || title.includes(searchLower)
      || description.includes(searchLower)
      || taskId.includes(searchLower);
    const matchesStatus = statusFilter === 'all' || task.status === statusFilter;
    const matchesPriority = priorityFilter === 'all' || task.priority === priorityFilter;

    return matchesSearch && matchesStatus && matchesPriority;
  });

  filtered.sort((a, b) => compareTasks(a, b, sortBy, sortOrder));
  return filtered;
}

/**
 * Compare two TaskMaster tasks by the selected business sort field.
 *
 * @param {Record<string, unknown>} a - First task.
 * @param {Record<string, unknown>} b - Second task.
 * @param {string} sortBy - Task field or special ordering to compare.
 * @param {string} sortOrder - `asc` or `desc`.
 * @returns {number} JavaScript Array.sort comparison result.
 */
function compareTasks(a, b, sortBy, sortOrder) {
  const [aVal, bVal] = getSortValues(a, b, sortBy);

  if (sortBy === 'updated') {
    return sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
  }

  if (typeof aVal === 'string') {
    return sortOrder === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
  }

  return sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
}

/**
 * Resolve comparable task values for TaskMaster-specific sort fields.
 *
 * @param {Record<string, unknown>} a - First task.
 * @param {Record<string, unknown>} b - Second task.
 * @param {string} sortBy - Sort mode selected by the user.
 * @returns {[number | string | Date, number | string | Date]} Comparable values.
 */
function getSortValues(a, b, sortBy) {
  switch (sortBy) {
    case 'title':
      return [String(a.title || '').toLowerCase(), String(b.title || '').toLowerCase()];
    case 'status': {
      const statusOrder = { pending: 1, 'in-progress': 2, done: 3, blocked: 4, deferred: 5, cancelled: 6 };
      return [statusOrder[a.status] || 99, statusOrder[b.status] || 99];
    }
    case 'priority': {
      const priorityOrder = { high: 3, medium: 2, low: 1 };
      return [priorityOrder[a.priority] || 0, priorityOrder[b.priority] || 0];
    }
    case 'updated':
      return [new Date(a.updatedAt || a.createdAt || 0), new Date(b.updatedAt || b.createdAt || 0)];
    case 'id':
    default:
      return getDottedTaskIdSortValues(a.id, b.id);
  }
}

/**
 * Compare TaskMaster dotted IDs such as 1, 1.1, and 2.3.
 *
 * @param {unknown} aId - First task id.
 * @param {unknown} bId - Second task id.
 * @returns {[number, number]} First differing numeric id segment.
 */
function getDottedTaskIdSortValues(aId, bId) {
  const parseId = (id) => String(id || '').split('.').map((part) => Number.parseInt(part, 10) || 0);
  const aIds = parseId(aId);
  const bIds = parseId(bId);

  for (let i = 0; i < Math.max(aIds.length, bIds.length); i += 1) {
    const left = aIds[i] || 0;
    const right = bIds[i] || 0;
    if (left !== right) {
      return [left, right];
    }
  }

  return [0, 0];
}
