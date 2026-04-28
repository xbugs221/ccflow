# repository-maintainability Specification

## ADDED Requirements

### Requirement: Reproducible pnpm package management

The repository SHALL use pnpm as the single supported package manager for dependency installation and package scripts.

#### Scenario: Fresh install uses pnpm lock state

- **WHEN** a developer installs dependencies from a clean checkout
- **THEN** `pnpm install --frozen-lockfile` succeeds
- **AND** dependency resolution is based on `pnpm-lock.yaml`
- **AND** npm lock state is not required

#### Scenario: Package scripts do not recurse through npm

- **WHEN** a developer runs development or production scripts
- **THEN** scripts that invoke other package scripts use pnpm-compatible commands

### Requirement: Generated workflow artifacts stay out of git

The repository SHALL keep generated workflow, execution, verification, cache, build, and local environment outputs out of git tracking unless explicitly documented as source assets.

#### Scenario: Workflow outputs are regenerated locally

- **WHEN** workflow tooling regenerates planner, execution, verification, or delivery outputs
- **THEN** those files remain untracked by default
- **AND** source-controlled files are not modified solely by generated runtime state

### Requirement: Source folders express ownership boundaries

The repository SHALL organize frontend, backend, shared, and test code by stable domain and runtime boundaries so developers can find ownership areas without reading unrelated modules.

#### Scenario: Frontend feature work starts

- **WHEN** a developer changes chat, projects, workflows, settings, sidebar, shell, git, file-tree, or task-management behavior
- **THEN** the primary UI, hooks, and feature-specific helpers for that domain are colocated under a predictable feature boundary
- **AND** reusable UI primitives and generic utilities are kept outside feature-specific folders

#### Scenario: Server route work starts

- **WHEN** a developer changes a server route
- **THEN** route files remain thin request/response adapters
- **AND** business logic lives in domain service modules
- **AND** reusable server helpers are not duplicated inside route files

### Requirement: Large modules are split by business responsibility

The repository SHALL reduce large high-coupling modules by extracting pure helpers, service functions, and focused view/controller modules without changing user-visible behavior.

#### Scenario: A hotspot module is refactored

- **WHEN** logic is extracted from a large component, hook, route, or server module
- **THEN** extracted functions have clear business-purpose comments or docstrings
- **AND** tests cover the extracted behavior or the workflow that depends on it
- **AND** existing public behavior remains compatible

### Requirement: Verification covers real workflows

The repository SHALL validate this refactor with commands and tests that reflect real development and runtime workflows.

#### Scenario: Refactor is complete

- **WHEN** the change is ready for review
- **THEN** install, build, typecheck, and relevant workflow tests have been run
- **AND** verification includes chat/session, project/workflow, taskmaster, git, and package-manager behavior where those areas were touched
