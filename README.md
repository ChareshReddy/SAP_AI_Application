# SAP AI Operations Agent & Business Partner Web Portal

A secure, enterprise-grade AI Operations Agent and web application built with **React** and **Node.js/Express** for SAP S/4HANA and ECC systems. The platform delivers autonomous diagnosis, human-in-the-loop operational remediation, multi-system routing (DEV/QA/PROD), persistent runbook error learning, and unified OData v2 integration.

---

## Architecture Overview

```
SAP_Application/
├── backend/
│   ├── server.js                          # Express application entry point & startup safety verification
│   ├── config/
│   │   ├── riskLevels.js                  # Risk classification (Levels 1-4) & startup tool integrity check
│   │   ├── systemRegistry.js              # Multi-system routing (DEV, QA, PROD) & environment safeguards
│   │   ├── errorKnowledgeBase.js          # Persistent runbook error rules & learning engine
│   │   └── entitySchemas/                 # Dynamic entity schemas and generic registry
│   │       ├── index.js                   # ENTITY_REGISTRY and generic schema query utilities
│   │       ├── businessPartner.js         # Business Partner entity schema (A_BusinessPartner)
│   │       ├── backgroundJob.js           # SM37 Background Job schema (A_BackgroundJob)
│   │       ├── idoc.js                    # IDoc Monitoring schema (A_IDoc)
│   │       ├── interfaceMonitor.js        # Interface Flow Monitoring schema (A_InterfaceMonitor)
│   │       ├── applicationLog.js          # SLG1 Application Log schema (A_ApplicationLog)
│   │       ├── purchaseOrder.js           # Purchase Order schema (A_PurchaseOrder)
│   │       ├── financialDocument.js       # Financial Document schema (A_FinancialDocument)
│   │       └── knowledgeBase.js           # Error Knowledge Base schema (A_ErrorKnowledgeBase)
│   ├── routes/
│   │   ├── auth.js                        # Login, logout, session verification
│   │   ├── chat.js                        # Conversational AI assistant with Level 2/3 safety gates
│   │   ├── entities.js                    # Dynamic generic OData entity endpoints
│   │   ├── businessPartners.js            # Legacy Business Partner endpoint
│   │   ├── knowledgeBase.js               # Admin CRUD & metrics for Error Knowledge Base
│   │   └── debug.js                       # Schema comparison & diagnostic endpoints
│   ├── services/
│   │   ├── sapClient.js                   # Unified client: Mock cache & real SAP OData v2 Gateway
│   │   ├── sapRfcClient.js                # RFC / BAPI client stub (NetWeaver RFC SDK placeholder)
│   │   ├── schemaValidator.js             # Schema vs Gateway field alignment diagnostic engine
│   │   ├── encryption.js                  # AES-256-GCM credential encryption
│   │   ├── sessionStore.js                # Encrypted in-memory session cache with TTL
│   │   ├── pendingActions.js              # In-memory store for pending human confirmation actions
│   │   └── auditLog.js                    # Immutable audit logging service with business justification
│   ├── mock/                              # Mock SAP datasets & persistent stores
│   │   ├── businessPartners.json          # 66 realistic SAP Business Partner records
│   │   ├── backgroundJobs.json            # SM37 mock background jobs with spool logs
│   │   ├── idocs.json                     # Inbound/Outbound IDocs with segment error messages
│   │   ├── interfaceLogs.json             # API/EDI/RFC interface integration logs
│   │   ├── applicationLogs.json           # SLG1 application logs with error contexts
│   │   ├── purchaseOrders.json            # Purchase orders with approval/blocked release states
│   │   ├── financialDocuments.json        # G/L accounting documents with debit/credit line items
│   │   └── errorKnowledgeBase.json        # Persisted runbook error patterns and occurrence metrics
│   ├── scripts/
│   │   └── schemaCheck.js                 # Terminal CLI diagnostic tool for Basis teams
│   ├── test/                              # 11 automated test suites covering all capabilities
│   └── package.json
└── frontend/
    ├── src/
    │   ├── components/
    │   │   ├── Login.jsx                  # SAP Gateway credentials login card
    │   │   ├── EntityTable.jsx            # Dynamic data table with column sort, pagination, filters
    │   │   ├── ChatBox.jsx                # Interactive AI Operations Assistant
    │   │   ├── ConfirmationCard.jsx       # Propose-confirm card with reason input & PROD safeguard
    │   │   └── FilterRange.jsx            # ID range filtering component
    │   ├── services/
    │   │   └── api.js                     # Unified API client with multi-system headers
    │   ├── App.jsx                        # SAP Fiori Shell, system switcher (DEV/QA/PROD), tabs
    │   └── index.css                      # SAP Horizon / Fiori styling
    ├── index.html
    ├── vite.config.js
    └── package.json
```

---

## 1. Supported SAP Entities & Transactions

| Entity Key | SAP Transaction / OData Set | Operations Supported | Risk Level |
|---|---|---|:---:|
| `businessPartner` | BP / `A_BusinessPartner` | Read, Range Filter, Create, Update, Master Data Change | Level 1, 2, 3 |
| `backgroundJob` | SM37 / `A_BackgroundJob` | Read, Filter by Status/JobName, Propose Retry | Level 1, 2 |
| `idoc` | WE02, WE05, BD87 / `A_IDoc` | Read, Filter by Status/Partner, Propose Reprocess | Level 1, 2 |
| `interfaceMonitor` | Interface / `A_InterfaceMonitor`| Read, Direction Filter, Transient Error Reprocess | Level 1, 2 |
| `applicationLog` | SLG1 / `A_ApplicationLog` | Read, Filter by Severity/Object/Subobject | Level 1 (Read-Only) |
| `purchaseOrder` | ME21N, ME28 / `A_PurchaseOrder` | Read, Filter by Status, Propose PO Release | Level 1, 3 |
| `financialDocument` | FB01, FB03 / `A_FinancialDocument`| Read, Propose G/L Posting (Strict scrutiny) | Level 1, 3 |
| `knowledgeBase` | Custom / `A_ErrorKnowledgeBase` | View Runbooks, Update Patterns, Real-time Metrics | Admin CRUD |

---

## 2. Action Risk Classification Framework

Actions are strictly categorized into 4 risk tiers following the enterprise AI governance model:

- **Level 1 — Read-Only Queries**: Automated execution permitted. Searches records, inspects spools, retrieves logs, and returns diagnostics without mutating SAP data.
- **Level 2 — Recoverable Operational Writes**: Mandatory human confirmation. Includes retrying transient background jobs (`JOB_CANCELLED_DB_TIMEOUT`), reprocessing IDocs (`IDOC_PARTNER_LOCKED`), and restarting failed interface transmissions.
- **Level 3 — Sensitive Operations**: Mandatory human confirmation **plus** mandatory business justification reason. Modifying master data fields (tax numbers, reconciliation accounts), releasing purchase orders (`release_po`), or posting financial journal entries (`post_fi_doc`). On **PROD**, requires typing the keyword `CONFIRM` to unlock.
- **Level 4 — Destructive / Unauthorized Operations**: **Permanently Blocked**. Deleting financial documents, clearing database tables, cancelling mass batches, or modifying system configuration tables (`T000`, `USR02`). No AI tool is ever registered or exposed for Level 4 actions.

---

## 3. Startup Safety Integrity Gate

During backend startup (`server.js`), `verifyAllToolsSafety(TOOLS)` runs an automated integrity scan across all registered AI tools:
1. **Level 4 Detection**: Throws a fatal exception if any tool possesses `riskLevel >= 4` or performs destructive operations.
2. **Autonomous Execution Bypass Check**: Throws a fatal exception if any tool has `autoExecute: true` without explicit human confirmation.

If a security rule is violated, the application terminates immediately on startup to prevent accidental deployment of unauthorized tools.

---

## 4. Multi-System Architecture & Production Safeguards

The platform connects to three distinct system tiers managed by `backend/config/systemRegistry.js`:

```
┌────────────────────────────────────────────────────────┐
│               Enterprise Multi-System Selector         │
└────────────────────────────────────────────────────────┘
       │                          │                       │
       ▼                          ▼                       ▼
  [DEV: Sandbox]            [QA: Staging]          [PROD: Production]
  • Safe testing sandbox    • Staging regression   • LIVE BUSINESS DATA
  • Standard confirmation   • Standard confirm     • Enforced reason
                                                   • Double confirmation
                                                   • Keyword: "CONFIRM"
```

- **Environment Isolation**: `resolveSapBaseUrl(systemKey)` ensures queries and mutations target the designated SAP host (`SAP_DEV_URL`, `SAP_QA_URL`, `SAP_PROD_URL`).
- **PROD Double Confirmation**: Whenever a Level 3 action targets `PROD`, the backend rejects confirmation until the user explicitly supplies `prodConfirmation: "CONFIRM"`. The frontend renders a highlighted red production badge and unlocks the confirmation button only when the user types the exact keyword.

---

## 5. Error Knowledge Base & Machine Learning Maturity

The system features a persistent, self-maturing operational knowledge base:
- **Disk Persistence**: Loaded and saved dynamically to `backend/mock/errorKnowledgeBase.json`.
- **Empirical Usage Tracking**:
  - `occurrenceCount`: Incremented every time an error is diagnosed across job, IDoc, or interface logs.
  - `successfulResolutionCount`: Incremented when an automated or confirmed remediation completes successfully.
  - `lastSeen`: ISO timestamp updated automatically on error detection.
- **Maturity-Enriched Diagnostics**: AI error diagnostics report empirical success rates (e.g., *"Database timeout has been seen 18 times with an 89% resolution rate via automatic retry"*).
- **Admin CRUD API**: Operations teams can add new regex patterns and runbooks dynamically via `/api/knowledge-base` without rebuilding or redeploying code.

---

## 6. Real SAP Gateway Integration Layer

- **Dynamic Toggle**: Single environment flag `USE_MOCK_SAP=true` toggles between mock memory caches and live SAP Gateway calls.
- **OData v2 Client**: Builds valid OData queries (`$filter`, `$top`, `$skip`, `$expand`, `$inlinecount=allpages`).
- **CSRF Token Handshake**: Two-step handshake fetching `x-csrf-token: fetch` and session cookies before executing `POST`, `PATCH`, or `DELETE`.
- **PATCH Fallback to MERGE**: Automatic fallback to `X-HTTP-Method: MERGE` if an SAP Gateway rejects HTTP `PATCH` with 405 Method Not Allowed.
- **SAP Error Parser**: Extracts SAP Gateway JSON messages (`error.message.value`, `innererror.errordetails`) and maps HTTP codes (400, 401, 403, 404, 409, 500, 502/504) to actionable explanations.
- **Schema Diagnostics Tool**: Terminal utility (`node backend/scripts/schemaCheck.js`) for Basis teams to compare schema models with live SAP metadata.

---

## 7. Quick Start

### Prerequisites
- Node.js v18+ and npm
- Windows, macOS, or Linux

### 1. Backend Setup

```bash
cd backend
npm install
npm test          # Runs all 11 automated test suites
npm run dev       # Starts backend server on http://localhost:5000
```

### 2. Frontend Setup

```bash
cd frontend
npm install
npm run build     # Verify production build
npm run dev       # Starts frontend dev server on http://localhost:5173
```

Open `http://localhost:5173` in your browser. Default login credentials:
- **Username**: `SAP_USER`
- **Password**: Any non-empty password (in mock mode)

---

## 8. Automated Test Suites

The test suite consists of 11 comprehensive suites executed sequentially via `npm test`:

```
======================================================
1. test/api.test.js                 - Auth, cookies, rate limits, Business Partner CRUD
2. test/chat.test.js                - Conversational AI, intent parsing, tool routing
3. test/writeActions.test.js        - Propose -> Confirm -> Execute lifecycle, audit logs
4. test/genericEntities.test.js     - Dynamic entity schemas, range filtering, pagination
5. test/jobMonitoring.test.js       - SM37 job monitoring, log parsing, retry proposals
6. test/idocMonitoring.test.js      - IDoc error classification, status synonyms, reprocess
7. test/interfaceMonitoring.test.js - API/EDI/RFC flow monitoring, SLG1 application logs
8. test/realSapIntegration.test.js  - OData v2 queries, CSRF handshake, schema validator
9. test/sensitiveActions.test.js    - Level 3 actions, mandatory reason, Level 4 block
10. test/multiSystem.test.js        - DEV/QA/PROD routing, PROD double-confirmation gate
11. test/knowledgeBase.test.js      - Disk persistence, occurrence counters, Admin CRUD
======================================================
```

---

## 9. Switching to Real SAP S/4HANA / ECC

When SAP Gateway endpoints and credentials become available:

1. Open `backend/.env`
2. Update configuration parameters:
   ```env
   USE_MOCK_SAP=false
   SAP_AUTH_METHOD=basic
   SAP_DEV_URL=https://s4dev.corp.internal:44300/sap/opu/odata/sap
   SAP_QA_URL=https://s4qa.corp.internal:44300/sap/opu/odata/sap
   SAP_PROD_URL=https://s4prod.corp.internal:44300/sap/opu/odata/sap
   ```
3. Restart the backend server. The UI seamlessly connects to real SAP Gateway OData services.

---

## 10. Enterprise Security Model

To safely introduce an AI Operations Agent into enterprise SAP landscapes, organizations must implement strict role separation, credential governance, and promotion controls.

### 10.1 Dedicated Technical Service Account (`AI_SAP_AGENT`)

1. **User Type**: The agent must connect using a dedicated SAP user of type **B (System)** or **C (Communication Data)** created in transaction `SU01`.
   - **No Dialog / SAP GUI Access**: Communication users cannot log in to SAP GUI (`SAPGUI`), preventing interactive misuse.
   - **Audit Traceability**: All RFC, OData, and BAPI calls are explicitly attributed to `AI_SAP_AGENT` in the SAP System Log (`SM21`) and Security Audit Log (`SM20`).
2. **Authentication**:
   - **X.509 Client Certificate** or **OAuth 2.0 Mutual TLS (mTLS)** for production environments.
   - Securely vaulted passwords rotated every 60-90 days via enterprise secret management (e.g., HashiCorp Vault, AWS Secrets Manager, Azure Key Vault).

### 10.2 Least-Privilege PFCG Authorization Matrix

The technical user must NEVER be assigned `SAP_ALL` or `SAP_NEW`. Authorizations should be split into discrete PFCG single roles:

| Role Name | Scope | Authorization Objects & Field Values |
|---|---|---|
| `Z_AI_OPERATIONS_RO` | Read-only inspection across all monitoring entities | `S_TABU_DIS` (DICBERCLS: `SS`, `SC`, ACTVT: `03`)<br>`S_BTCH_JOB` (JOBACTION: `DELE`, `SHOW`, `LIST`, ACTVT: `03`)<br>`S_IDOC_ALL` (EDI_MES: `*`, ACTVT: `03`)<br>`S_APPL_LOG` (ALG_OBJECT: `*`, ACTVT: `03`) |
| `Z_AI_OPERATIONS_OPS` | Operational Level 2 retries & reprocessing | `S_BTCH_JOB` (JOBACTION: `RELE`, `PLAN`, ACTVT: `01`, `16`)<br>`S_IDOC_ALL` (EDI_MES: `ORDERS05`, `INVOIC02`, ACTVT: `16`)<br>`S_PROGRAM` (P_ACTION: `BTCSUBMIT`, P_GROUP: `Z_OPS_JOBS`) |
| `Z_AI_OPERATIONS_SENSITIVE` | Level 3 Sensitive PO release and FI postings | `M_BEST_EKO` (EKORG: `1000`, `2000`, ACTVT: `03`, `16` - Release PO)<br>`M_BEST_BSA` (BSART: `NB`, ACTVT: `16`)<br>`F_BKPF_BUK` (BUKRS: `1000`, ACTVT: `01` - Post FI Document)<br>`B_BUPA_GRP` (BU_GROUP: `*`, ACTVT: `02` - Update Master Data) |

### 10.3 Destructive Action Fencing (Level 4 Protections)

The following authorizations must be explicitly excluded from `AI_SAP_AGENT` PFCG profiles:
- `S_TABU_DIS` with `ACTVT: 02` (Change Table Contents directly)
- `S_DATASET` (Direct application server file read/write)
- `S_DEVELOP` (ABAP Workbench development, transport modification)
- `S_USER_*` (User maintenance and role assignments)

### 10.4 Promotion Path & Environment Governance

Operational changes follow a rigorous promotion path:

```
[DEV: Sandbox] ──> [QA: Quality / Staging] ──> [PROD: Production]
```

1. **Phase 1 — DEV (Sandbox)**:
   - Full mock and sandboxed execution.
   - Validation of prompt parsing, synonym mappings, and error categorization.
   - Runbook rule formulation in `errorKnowledgeBase.json`.
2. **Phase 2 — QA (Quality & Staging)**:
   - Live OData testing with non-production SAP systems.
   - Testing authorization boundaries: ensuring `AI_SAP_AGENT` receives 403 Forbidden on unpermitted transactions.
   - Load, latency, and session timeout validation under simulated network latency.
3. **Phase 3 — PROD (Production)**:
   - Human-in-the-loop strictly mandatory for all modifying actions.
   - Level 3 actions require dual gates: valid business justification reason + explicit `CONFIRM` keyword.
   - Real-time logging to `backend/services/auditLog.js` and enterprise SIEM via syslog/webhook.
   - Regular review of knowledge base resolution metrics by Basis and SAP Operations Leads.
