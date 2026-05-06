# repository-cleanup-followup Specification

## ADDED Requirements

### Requirement: Follow-up cleanup is evidence-led

The system SHALL base repository cleanup decisions on current repository facts instead of prior task status alone.

#### Scenario: Prior cleanup change is complete

- **WHEN** a previous repository cleanup change is marked complete
- **THEN** the follow-up audit checks current git tracking state, ignored files, package manager metadata, documentation references, and hotspot files
- **AND** records any mismatch before proposing deletion or refactoring

### Requirement: Stale documentation is classified before removal

The repository SHALL classify stale or process-oriented documentation before removing it.

#### Scenario: A document references generated artifacts

- **WHEN** a document references ignored workflow, execution, verification, or delivery artifacts
- **THEN** the cleanup classifies the reference as current source documentation, stale design note, or one-time process artifact
- **AND** only removes or rewrites it after that classification is clear

### Requirement: Generated artifact boundaries stay explicit

The repository SHALL keep generated local outputs out of git while making the source/generated boundary easy to verify.

#### Scenario: Local workflow outputs exist

- **WHEN** planner, execution, verification, delivery, cache, build, or browser-test outputs exist locally
- **THEN** they remain untracked by default
- **AND** cleanup verification checks both git tracking state and ignore coverage

### Requirement: Refactor candidates are triaged before code movement

The repository SHALL triage large module refactor candidates before moving or extracting business logic.

#### Scenario: A hotspot remains after prior cleanup

- **WHEN** a large route, server module, component, or hook remains a hotspot
- **THEN** the follow-up records its responsibility mix, risk level, available workflow tests, and suggested slice
- **AND** high-risk business refactors are split into independent follow-up changes
