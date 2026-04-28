/**
 * PURPOSE: Build and parse canonical project, workflow, and session routes.
 */
import type { Project } from '../types/app';

type ProjectRouteTarget = Pick<Project, 'fullPath' | 'path' | 'name'> & { routePath?: string };
type WorkflowRouteTarget = { routeIndex?: number; id?: string };
type SessionRouteTarget = { routeIndex?: number; id?: string };

function normalizeSlashPath(value: string): string {
  const normalized = String(value || '').replace(/\\/g, '/').replace(/\/+/g, '/');
  if (!normalized || normalized === '/') {
    return '/';
  }
  return normalized.startsWith('/') ? normalized.replace(/\/+$/g, '') : `/${normalized.replace(/\/+$/g, '')}`;
}

export function getProjectRoutePath(project: ProjectRouteTarget): string {
  return normalizeSlashPath(project.routePath || project.fullPath || project.path || project.name);
}

function assertIndexedSegment(prefix: 'w' | 'c', target: WorkflowRouteTarget | SessionRouteTarget): string {
  if (prefix === 'c' && typeof target?.id === 'string' && /^c\d+$/.test(target.id)) {
    return target.id;
  }

  const routeIndex = Number(target?.routeIndex);
  if (!Number.isInteger(routeIndex) || routeIndex <= 0) {
    throw new Error(`Missing stable ${prefix.toUpperCase()} route index`);
  }
  return `${prefix}${routeIndex}`;
}

export function buildProjectRoute(project: ProjectRouteTarget): string {
  return getProjectRoutePath(project);
}

export function buildProjectWorkflowRoute(
  project: ProjectRouteTarget,
  workflow: WorkflowRouteTarget,
): string {
  return `${buildProjectRoute(project)}/${assertIndexedSegment('w', workflow)}`;
}

export function buildProjectSessionRoute(
  project: ProjectRouteTarget,
  session: SessionRouteTarget,
): string {
  return `${buildProjectRoute(project)}/${assertIndexedSegment('c', session)}`;
}

export function buildWorkflowChildSessionRoute(
  project: ProjectRouteTarget,
  workflow: WorkflowRouteTarget,
  session: SessionRouteTarget,
): string {
  return `${buildProjectWorkflowRoute(project, workflow)}/${assertIndexedSegment('c', session)}`;
}

export function parseIndexedRouteSegment(segment: string, prefix: 'w' | 'c'): number | null {
  const matched = String(segment || '').match(new RegExp(`^${prefix}(\\d+)$`));
  if (!matched) {
    return null;
  }

  const parsed = Number.parseInt(matched[1], 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
