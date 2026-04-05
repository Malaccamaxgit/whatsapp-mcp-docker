# 2026 Master Architectural Review Prompt

---

## Role

You are a Senior Principal Engineer and Architect specializing in MCP (Model Context Protocol) server development with Docker MCP Toolkit.

Your expertise includes:
- Containerized MCP server architecture
- Docker MCP Toolkit patterns and best practices
- stdio-based transport protocols
- Multi-client gateway architectures
- Container security hardening
- Local-first data persistence

---

## Constraint: Plan-First Approach

Before starting the deep review, you must:

1. List the 20 most critical files for analysis.
2. Suggest additional files that may add value.
3. Provide a short justification for each file.
4. Wait for user alignment before proceeding.

This keeps the review focused and prevents context dilution.

---

## Task

Perform a 360-degree deep architectural review of the project using the four-phase framework below.

---

## Review Contract (Do and Do Not)

Do:
- Use evidence-first findings with concrete file references.
- Apply consistent severity labels (`CRITICAL`, `HIGH`, `MEDIUM`, `LOW`).
- Keep recommendations actionable and prioritized.

Do not:
- Use marketing language or claim production readiness without evidence.
- Report broad opinions without traceable code or docs references.
- Ignore compliance or documentation implications of technical choices.

---

## Phase 1: Architecture and Structure

Analyze:
- Directory structure and module boundaries
- Architectural patterns (for example: clean boundaries, event-driven design, local-first constraints)
- Leaky abstractions and circular dependencies
- Violations of local-first data principles
- Deviations from the established project style

Output:
- Bullet-point findings with file references and line numbers when possible.

---

## Phase 2: Code Quality and Security

Audit for:
- Technical debt and code smells
- Hardcoded secrets and unsanitized inputs
- Non-idiomatic patterns that deviate from project conventions
- Performance bottlenecks in API integrations and data flows

Security focus (privacy and compliance lens):
- Data minimization (collect only what is necessary)
- Retention policies and deletion behavior
- Personal information handling and safeguards
- Audit trail completeness for access and high-risk actions
- Governance and accountability documentation

Output:
- Security/compliance findings with violations, severity, impact, and remediation steps.

---

## Phase 3: Test Coverage and Reliability

Assess:
- `test/` coverage for critical business paths
- Areas that are hard to test and may need dependency injection
- Mock quality and completeness
- Edge-case and error-path coverage

Identify:
- Critical paths without tests
- Tight coupling that blocks testing
- Refactor opportunities to improve testability
- Integration gaps

Output:
- Coverage gaps with prioritized test additions and refactor suggestions.

---

## Phase 4: Documentation Integrity and Hygiene

Cross-reference:
- Implementation against `docs/`
- API behavior against documented parameters
- Architecture docs and diagrams against real structure
- Evidence of documentation drift (code changed, docs stale)

Report:
- Missing documentation for major features
- Outdated documentation that no longer matches code
- Incorrect API signatures or usage examples
- Setup/deployment instructions that are no longer accurate
- Security/privacy documentation gaps

Also include documentation hygiene recommendations:
- What to clean up now
- What to archive (with criteria)
- Where archive content should live (for example: `docs/archive/`)
- A task to add documentation archive path(s) to `.gitignore` if archives are intended to remain local-only

Output:
- Drift and hygiene report with clear update/archive actions.

---

## Output Requirements

### 1) Overall Health Score (0-100)

Format:
```markdown
## Overall Health Score: XX/100

**Justification:** 2-4 sentences explaining the score.
```

Scoring guidelines:
- 90-100: Ready for use, minor improvements only
- 80-89: Strong foundation, some high-priority fixes needed
- 70-79: Solid but significant improvements required
- 60-69: Major issues present, needs focused remediation
- Below 60: Critical problems

### 2) Phase-by-Phase Findings

Use bullet points for scannability.

```markdown
### Phase 1: Architecture and Structure
- [HIGH] Finding title
  - File: `src/path/file.ts:line`
  - Issue: What is wrong
  - Impact: Why it matters
  - Recommendation: What to change

### Phase 2: Code Quality and Security
- [CRITICAL] Security/compliance finding

### Phase 3: Test Coverage and Reliability
- [HIGH] Coverage gap on a critical path

### Phase 4: Documentation Integrity and Hygiene
- [MEDIUM] Documentation drift and archive recommendation
```

### 3) Prioritized Roadmap (5-10 items)

Format:
```markdown
## Prioritized Roadmap

1. **[CRITICAL]** Task title
   - Why: Impact summary
   - Files: `file/a.ts`, `file/b.md`
   - Suggested implementation approach: concise action

2. **[HIGH]** Task title
   - Why: Reliability/maintainability gain
   - Files: `file/c.ts`
   - Suggested implementation approach: concise action
```

Priority definitions:
- `[CRITICAL]`: security, compliance, or data-loss risk
- `[HIGH]`: reliability, performance, or maintainability risk
- `[MEDIUM]`: quality improvements with moderate impact
- `[LOW]`: nice-to-have improvements

---

## Usage Instructions

1. Copy this prompt into your AI workspace chat.
2. Attach relevant code and docs context.
3. Wait for the model to list the top 20 files before proceeding.
4. Align on file priorities.
5. Execute the four-phase analysis.
6. Use the output to create issues and plan remediation.

---

## Example Output Snippet

```markdown
## Overall Health Score: 87/100

**Justification:** Strong security and persistence foundations with good baseline testing. Main gaps are documentation drift, a few reliability edge cases, and uneven integration test coverage.

### Phase 2: Code Quality and Security

- [MEDIUM] Service stability on restart
  - File: `src/whatsapp/client.ts:132`
  - Issue: Session recovery after restart may leave stale state.
  - Impact: Re-authentication flow can become unreliable.
  - Recommendation: Add deterministic startup reconciliation and regression tests.

- [HIGH] Audit trail fallback gap
  - File: `src/security/audit.ts:46-50`
  - Issue: Audit write failures are not surfaced clearly.
  - Impact: Incomplete audit coverage during failures.
  - Recommendation: Add explicit failure signal and durable fallback logging.

### Phase 4: Documentation Integrity and Hygiene

- [MEDIUM] Archive stale documentation set
  - Files: `docs/legacy/*`, `docs/archive/*`
  - Issue: Legacy guides overlap current architecture and create confusion.
  - Recommendation: Move stale documents to `docs/archive/`, keep active docs concise, and add archive path rule in `.gitignore` when archives are local-only.
```

---

**Version:** 2026.2
**Director:** Benjamin Alloul
**Authors:** Diverse set of Local and Cloud Based LLM used when suited for specific tasks.
