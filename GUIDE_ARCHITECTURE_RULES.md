# Implementation Rules for LLM-Linked Guide Delivery (Secure Version)

## 1. Policy

- Do not let the LLM write executable code.
- The LLM only returns the guide definition JSON.
- Execution is handled exclusively by the fixed runtime on the extension side.

## 2. Overall Configuration

1. Content Script Runtime
2. Extension Service Worker
3. Guide API Server
4. LLM Adapter
5. Policy Engine

## 3. Responsibilities of Each Component

### 3.1 Content Script Runtime

- Reads the page DOM.
- Executes the guide JSON.
- Displays the guide UI.
- Sends execution logs.

### 3.2 Service Worker

- Communicates with the Guide API.
- Adds authentication headers.
- Rate limiting.
- Short-term caching.

### 3.3 Guide API Server

- Request validation.
- LLM invocation.
- Validation of generation results.
- Guide signing.
- Guide delivery.

### 3.4 LLM Adapter

- Prompt management.
- Model invocation.
- Retry control.

### 3.5 Policy Engine

- Domain-specific permission rules.
- Definition of allowed operations.
- Management of prohibited selectors.

## 4. Message Specifications

### 4.1 Runtime -> Worker

`GUIDE_GENERATE_REQUEST`

- requestId
- pageUrl
- pageTitle
- language
- domSnapshot
- userIntent
- contextVersion

### 4.2 Worker -> Guide API

`POST /v1/guides/generate`

- sessionId
- tenantId
- pageContext
- intent
- capabilities
- maxSteps

### 4.3 Guide API -> Worker

`GuidePackage`

- guideId
- version
- expiresAt
- steps
- theme
- constraints
- signature

### 4.4 Runtime -> Worker

`GUIDE_EVENT`

- guideId
- stepId
- eventType
- timestamp
- result

## 5. Recommended Structure for GuidePackage

### 5.1 Top-level

- guideId: string
- version: integer
- expiresAt: ISO8601
- locale: string
- steps: array
- theme: object
- constraints: object
- signature: string

### 5.2 Step

- stepId: string
- selector: string | null
- title: string
- description: string
- action: enum
- placement: enum
- nextCondition: enum
- timeoutMs: integer

### 5.3 action enum

- highlight
- tooltip
- scrollIntoView
- focusInput
- waitForClick
- waitForText
- complete

### 5.4 placement enum

- top
- right
- bottom
- left
- center

### 5.5 constraints

- allowedDomains: array
- blockedSelectors: array
- maxDomOps: integer
- maxDurationMs: integer

## 6. Validation Rules

1. Selector Validation
   - Reject full-page destructive elements like `script`, `iframe`, `html`, `body`.
   - Only execute allowed selector patterns.
2. Action Validation
   - Reject anything outside the enum.
3. String Length Validation
   - `title`: max 80 characters.
   - `description`: max 400 characters.
4. Step Count Validation
   - Between 1 and 10.
5. Domain Validation
   - Reject if `pageUrl` does not match `allowedDomains`.
6. Signature Validation
   - Discard if signature does not match.
7. Expiration Validation
   - Do not execute if `expiresAt` is exceeded.

## 7. Secure Execution Rules

1. Prohibit `eval`, `new Function`, or any arbitrary script execution.
2. Limit DOM changes to fixed runtime functions.
3. Limit style injection to namespaced classes.
4. Roll back immediately on failure.
5. Set limits on the number of operations and execution time per guide.

## 8. Minimum API Set

1. `POST /v1/guides/generate`
   - Returns a `GuidePackage`.
2. `POST /v1/guides/events`
   - Records step start, completion, and failure.
3. `GET /v1/guides/policy`
   - Distributes permission rules by domain.

## 9. Execution Flow

1. After page load, the Runtime creates a lightweight DOM summary.
2. The Worker requests guide generation from the Guide API.
3. The Guide API validates the LLM generation results and signs them.
4. The Runtime executes the guide after signature verification.
5. Progresses to the next step based on user action.
6. Sends execution logs to the events API.

## 10. PoC Success Criteria

1. If English button is not selected:
   - Guide for English -> Wait for click -> Resume Search after transition.
2. If English button is already selected:
   - Skip explanation only for that step, continue other steps.
3. No UI destruction:
   - Minimal differences in major layout.
4. Security:
   - Zero arbitrary JS execution.
   - Rejection of guides with mismatched signatures.

## 11. Schema Management

- Refer to [guide-package.schema.json](guide-package.schema.json) for formal `GuidePackage` validation rules.
- The server must always schema-validate the LLM response before returning it.
- The extension must also re-validate upon reception and discard if validation fails.

### 11.1 Key Implementation Points for Validation

1. Validate immediately after generation:
    - Validate the LLM response JSON against [guide-package.schema.json](guide-package.schema.json).
2. Validate before signing:
    - Never sign invalid JSON.
3. Validate before execution:
    - Re-validate within the Runtime for double-guard protection.

### 11.2 Compatibility Rules

1. `version` is mandatory; increment major on breaking changes.
2. Reject items that are not compatible with existing clients using `additionalProperties: false`.
3. To add new items, update the schema first, then the generation side.

### 11.3 Error Handling

1. Do not execute guidelines when a validation error occurs.
2. Display "Could not generate guide" to the user.
3. Log `requestId`, `guideId`, and the name of the field that failed.
