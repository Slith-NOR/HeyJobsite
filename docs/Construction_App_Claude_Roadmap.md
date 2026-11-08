# Project X (working name) — Construction Site Accountability App Roadmap and Claude Prompt

## Product goal
A mobile-first web app lets a general contractor know who checked into each house, which company employs them, who hired that company, what work they performed, and whom to contact. Clients choose their preferred check-in methods: location-assisted property selection, manager-set short house codes, property QR codes, or reusable QR/NFC signs. All work in the browser without mandatory installation. Completion photos and contractor follow-up remain attached to the exact task.

This roadmap is a proposed implementation baseline. It does not claim that check-ins prove continuous presence, photos prove dimensional compliance, or worker submission constitutes inspection approval.

## First-release scope
- Multiple contractor accounts with strict separation of data.
- Projects containing individual houses/properties and tasks.
- Project-specific subcontracting relationships, including lower-tier subcontractors.
- Worker accounts (passkey or email-link login), check-in/out, optional event-based location, contact directory.
- Work photos, completion submissions, task conversations (built-in web messenger), review decisions.
- Web push and email notifications linking to the correct task conversation. No business SMS in the first release.
- Whereby Embedded live video walkthroughs tied to a house, task and submission; no mandatory app download and no recording by default.
- Searchable attendance and project history, exports, configurable retention.
- Multilingual from the first release: English, Spanish and Haitian Creole (see Languages and translation).
- Manager-configurable contact visibility and approval chains (see Hierarchy, contact and approval policies).

Defer native apps, continuous GPS, payroll, billing subscriptions, AI inspection, photo measurement, survey-grade location, and SMS of any kind (an optional later channel; see Phase 6).

## Proposed architecture
Decided stack: TypeScript and Next.js, Supabase (PostgreSQL, auth, private storage), Vercel hosting, and a notification adapter with web push and email channels. Twilio SMS is reserved as a later channel behind the same adapter. The product owner owns all provider accounts and billing. Development uses local simulators and needs no paid services. Verify current official documentation before implementing provider integrations. Use one application serving multiple contractor organizations; tenant means the subscribing general contractor account, not every subcontractor company.

Keep the browser experience simple: large buttons, camera upload, low typing burden, clear upload progress, and no mandatory installation. A login proves control of a passkey or email inbox, not employment or real-world identity. Company affiliation must be approved or shown as pending.

Store timestamps in UTC and display the project timezone. Use database transactions for check-in/out and review transitions. Use an outbox/job queue for notifications, bounded retries, provider event deduplication, and failure visibility. Use private storage and short-lived authorized download/upload URLs.

## Login, messaging and notifications
- **Login:** passkeys (Face ID, fingerprint or device PIN) as the primary method, with email magic links as the fallback and for account recovery. No SMS codes.
- **Onboarding without SMS:** a supervisor invites a worker with a single-use, expiring invite link or a QR code shown on the supervisor's own screen. The supervisor may forward the link through their own phone's texting or WhatsApp; that is personal messaging, not app-sent business SMS. Redeeming an invite creates a pending affiliation that still needs approval.
- **Messaging:** all conversation happens in the app's built-in, task-linked messenger, with live updates (Supabase Realtime) and unread counts. No external messenger such as WhatsApp or Telegram is used as the system of record.
- **Notifications:** web push is the primary alert channel; email is the backup when push is not enabled or delivery fails. Android Chrome supports push in the browser. iPhone requires adding the app to the Home Screen (iOS 16.4+), so onboarding shows a short, translated "Add to Home Screen" guide and a clear indicator when push is off. An in-app notification center lists everything, so a missed push never means a lost message.
- Phone numbers are stored as contact details for tap-to-call. They are shown as unverified and are never used for login or authorization.

## Roles and visibility
| Role | Access |
|---|---|
| General contractor admin | Manage own tenant, projects, companies, worker access, reviewers, exports and policies |
| Project manager/reviewer | Assigned projects, attendance, directory, task discussions and review decisions |
| Subcontractor supervisor | Assigned projects and explicitly authorized crews/tasks; lower-tier visibility only when granted |
| Worker | Own profile, authorized site check-in, assigned tasks and permitted conversations/photos |

Enforce authorization on the server and database/storage layer. Never rely on UI hiding, a QR token, phone number, or client-supplied tenant ID for authorization. Cross-company contact access is project-scoped and limited to operationally necessary fields.

One person has one global login. A worker or company can work for several general contractors who use the app; each general contractor's tenant sees only that person's membership, visits, tasks and messages within its own tenant. Nothing from one tenant is visible in another, even for the same user.

## Hierarchy, contact and approval policies
The general contractor's manager hires subcontractor companies on a project. A hired company's supervisor gains supervisor rights over the workers and lower-tier subcontractors that company brings in, and so on down the chain. The hierarchy is per project, built from SubcontractEngagement records.

Contact rules:
- Anyone can always see and contact everyone below them in their project chain.
- A worker can always contact their own direct supervisor.
- Every other upward or sideways contact is set by the main manager. Examples: a worker contacting the manager directly, or two subcontractors on the same house seeing each other's contacts. Store this as a tenant-level ContactPolicy with optional project overrides, enforced on the server like any other authorization rule.

Task assignment:
- The manager creates a task and assigns it to a subcontractor company. That company's supervisor assigns it to their own workers or delegates it to a lower-tier subcontractor, whose supervisor does the same.
- Each delegation is recorded with who delegated, to whom and when. A supervisor can only delegate within their own part of the chain, and the manager can always see the full delegation path.

Approval rules:
- The manager configures the approval chain per tenant, with project overrides where needed. Options include manager-only approval, or multi-level approval where each supervisor up the chain approves their lower tier's submission before it reaches the manager.
- Each approval step is a separate, attributed ReviewDecision on the exact submission version. Final approval is the last step required by the policy in effect when the submission was made. Record that policy version on the submission so later policy changes do not rewrite history.

## Languages and translation
- Supported languages: English, Spanish and Haitian Creole. Each user sets a preferred language, which controls the interface, push notifications and emails. The translation provider must support all three.
- User-written content (task conversations, notes, review reasons) is machine-translated when the viewer turns translation on. Translation is an on/off toggle per user. When it is on, the original and the translation are always shown together, and the translation carries a visible notice that it was machine-translated and the user should ask if anything is unclear.
- The original text is always the authoritative record. Store the original language and keep translations as derived, regenerable data. Exports and audits use originals, with translations optional.
- Numbers, units, measurements, addresses, house codes and names are never altered by translation. Show measurement records in their structured form, not just as translated prose.
- Use a translation provider behind an adapter. Development uses a clearly labeled fake translator. If translation fails, the original is still shown and nothing is lost.
- Translation quality review (native-speaker check of interface strings) is to be decided later. Keep all interface strings in translation files from the start.

## Core data model
| Entity | Key purpose |
|---|---|
| Tenant, User, TenantMembership | Account isolation; one global User with a membership per tenant; preferred language and translation toggle |
| ContactPolicy, ApprovalPolicy | Manager-set contact visibility and approval chain, tenant default with project overrides, versioned |
| MessageTranslation | Derived translation of user-written text: source/target language, provider, timestamp, machine-translated flag |
| Company, ProjectCompany | Employer directory and project participation |
| SubcontractEngagement | Project, hiring company, hired company, scope, effective dates; reject cycles |
| Project, Property | House identifier, address, timezone, optional coordinates/boundary |
| ProjectRole, WorkerAffiliation | Approved project access, employer and effective dates |
| SignPack, PhysicalSign, SignAssignmentHistory, CheckInPolicy | Pack ownership/claim, permanent public tokens, audited time-bounded property assignments and client/project method preferences |
| QRToken | Opaque, revocable property entry link; no embedded personal data |
| Visit | Worker, property, employer/engagement snapshot, server check-in/out, location accuracy/status |
| Task, TaskAssignment | Property, scope, responsible company/engagement, workers, reviewer; delegation history down the chain (delegated by, to, when) |
| Invite | Single-use, expiring onboarding link/QR issued by a supervisor; redeems to a pending affiliation |
| PushSubscription | Per-device web push endpoint, user, created/last-success times, revoked state |
| CompletionSubmission | Immutable numbered submission, notes, measurement claims and attached evidence |
| Attachment | Private object reference, size, type, checksum, uploader and processing state |
| ConversationMessage | Task-linked sender, text, attachments and timestamps |
| ReviewDecision | Reviewer, submission version, decision, reason and timestamp |
| Notification, OutboxEvent | Delivery state, deduplication, retries and provider references |
| VideoSession, VideoParticipant | Tenant/project/property/task/submission linkage, provider room ID, authorized invitees, expiry, actual join/leave events, outcome and notes |
| VideoUsage | Deduplicated provider usage, participant-minutes, tenant allocation, reconciliation status and budget counters |
| AuditEvent | Attributed changes, corrections, access-sensitive operations |

Companies may have different hiring relationships on different projects, or multiple scopes on the same project. Do not use one global parent_company field. Preserve historical employer/contract-chain attribution when assignments change. Keep visits and task status separate: leaving a site does not complete a task.

## Delivery phases and acceptance gates

### Phase 0 — Repository inspection and foundation
Inspect AGENTS.md, README, docs, package manifests, existing auth, database and deployment setup. Record assumptions and create docs/ROADMAP.md, docs/ARCHITECTURE.md and docs/DECISIONS.md. Establish migrations, environment example, local setup and synthetic seed data for two unrelated contractor tenants.

Acceptance: app runs locally; schema and permission model are documented; no real credentials or worker data are committed.

### Phase 1 — Projects, houses, companies and identities
Build authenticated administration, properties, project-scoped company engagements, worker registration through supervisor invites, supervisor approval, passkey and email-link login, and contact directory. Use a development email inbox locally; production must reject any fake login mode. Implement revocable remembered sessions, passkey management (add/remove devices) and email-based recovery.

Acceptance: a worker can be linked through two subcontracting levels; cyclic relationships are rejected; a user from tenant A cannot read or modify tenant B through APIs or storage URLs. Unapproved affiliation is clearly identified and cannot grant itself project access.

### Phase 2 — Client-selectable check-in/out and attendance dashboard
Build printable property QR codes first: a manager prints a QR code for each house, and that is the pilot check-in method. Add location-assisted selection and manager-set house codes after QR works end to end. Reusable QR/NFC sign packs come later (Phase 2B, after Phase 3). Each client can enable one or multiple methods and choose a preferred method, with project overrides and an explicit accessible fallback. Generate printable QR signs for each house when selected. Public QR landing pages expose only minimal site information; authenticated authorized workers check in with a server timestamp. Request location at the event, explain its purpose, and record accuracy, capture time and permission outcome. Use matched/mismatch/unavailable/low-accuracy statuses; configurable supervisor overrides include reasons. Adjacent houses cannot reliably be distinguished by phone GPS, so retain QR-selected property and show uncertainty.

Show checked-in workers, employer, hiring chain, task, time, contact buttons and stale visits. Prevent duplicate open visits under concurrency. Attempting a second property check-in requires resolving the existing visit rather than silently changing history. Forgotten check-outs generate reminders and a stale status; admin corrections preserve the original event and reason. Do not invent departure times.

Acceptance: repeat scan is idempotent; location denial does not masquerade as verification; concurrent submissions create one visit; expired/revoked QR links fail safely; missing checkout remains visible.

### Phase 2B — Reusable sign packs and self-service assignment
Build after Phase 3 (tasks and photos). Until then, the printable property QR codes from Phase 2 are the check-in method. Sign packs are not required for the pilot. Sell packs numbered 1–10 (pack sizes configurable); human-facing numbers can repeat between customers, but each sign has a globally unique opaque public resolver token. QR and optional NFC NDEF HTTPS records on a physical sign encode the same permanent application URL. Manufacture/program tags once and lock their URL against ordinary rewriting after QA; assignments change in the database, not on the sign. NFC is an optional physical accessory, not a requirement for app use. Provide initial pack provisioning/export tooling and a practical hardware fulfillment checklist; automated commerce/shipping is deferred.

A manager claims the purchased pack using a separate high-entropy private activation code. Claiming requires an authorized account, rate limits and an atomic one-time ownership transaction; store a hash of the claim secret. Never print the private activation code in the public QR or expose it in public resolver responses. Sign scans cannot claim ownership. Claimed packs appear under Manage signs, with assigned property, friendly number, enabled/lost status and last assignment date. Tenant admins delegate assignment permission explicitly. Ordinary managers cannot transfer signs between tenants; reserve ownership transfer for an audited recovery process.

Manager selects Sign 1 → Assign property → confirms address → saves; unassigning/reassigning requires no operator support. A sign can have only one active property assignment, while a property may have multiple signs. Only active properties in the owner's tenant are eligible. Close the previous assignment and create the next atomically, recording actor and effective timestamps. Unassigned/disabled signs show a generic unavailable page with no worker or property directory. Reassigning or disabling a sign never modifies past attendance, tasks, photos or video records. Archive-property handling must unassign or disable its signs explicitly.

Use SignPack, PhysicalSign, SignAssignmentHistory and CheckInPolicy entities. Keep physical sign number distinct from the manager-set house code. Codes are normalized, case-insensitive and unique within the tenant; tenant context comes from the client's URL/session, not an unscoped global lookup. Rate-limit house-code attempts and expose property details only to authorized users. Code changes preserve historical visits; avoid immediate code recycling or require an explicit warning/confirmation to prevent old instructions routing workers incorrectly.

Every entry method converges on one property confirmation page with address, verified worker identity and Check in/Check out action. Location assistance lists nearby authorized properties and captured accuracy; never automatically checks in or assumes GPS distinguishes adjacent houses. If location is denied/unavailable, use another enabled method. A code or QR/NFC token identifies a property; it does not authenticate a worker or prove physical presence.

On scan, resolve the current assignment using a noncached server lookup. Bind the displayed assignment version to the check-in request and revalidate it transactionally on submit; if the manager reassigned the sign while the page was open, reject the stale request and show the new address for fresh confirmation. No silent redirection/check-in to another house. Record entry method, sign ID and assignment ID as historical attribution. Check-out always closes the original visit/property, even if the sign has since moved. Existing sessions/links must not silently inherit another tenant or property.

Acceptance: manager claims a ten-sign pack and reassigns Sign 1 from House 12 to House 8 without developer intervention. The same QR and NFC open House 8 afterward; old records stay on House 12. Test simultaneous claims/assignments, stale open pages, cross-tenant attempts, disabled/lost/unassigned signs, archived properties, code collisions, location denial, NFC incompatibility and check-out after reassignment. Test every enabled method on iPhone Safari/Android Chrome; a client can operate without buying signs. Physical tag read/lock verification is a real-device gate, not a simulated software pass.

### Phase 3 — Work tasks, photos and completion submission
Managers create tasks and assign them to a responsible company/engagement; supervisors assign or delegate them down the chain (see Task assignment). Support camera capture and file selection, captions, upload retry, thumbnails, configurable image size/quality, explicit original retention policy, and file type/size validation. Mark metadata and worker-entered measurements as claims. Preserve original evidence where required; record any image processing. Incomplete uploads cannot appear as complete evidence.

Status flow: Draft → Assigned → In progress → Submitted for review → (one review step per level of the configured approval chain) → Approved. At each step a reviewer can request follow-up, require correction, or approve. Follow-up can return to review after a response; corrections require a new numbered submission. Approval records the exact submission version. Reopening approved work needs an authorized action and reason. The worker cannot approve their own task unless explicitly authorized by policy.

Acceptance: photos remain attached to the correct property/task/submission; old submissions remain available; unauthorized viewers cannot download files; network retries cannot duplicate completion submissions.

### Phase 4 — Contractor notification and task-specific follow-up
All notifications are sent in the recipient's preferred language. On submission, notify the reviewer for the current approval step by web push (email if push is unavailable or fails): property, task, submitting company and a link to the task. Keep notification text minimal so lock screens do not expose sensitive detail. The link alone never grants access or approval authority; the recipient must be logged in and authorized. Follow-up questions and worker replies occur in the mobile web task conversation. Notify the assigned worker or supervisor, respecting preferences and verified recipients. Include unread indicators and outstanding requests.

Record requested measurements with value, unit, reference points, method and supporting photo when supplied. Do not infer physical dimensions from a normal photo.

Acceptance scenario: John submits House 12 bathroom rough-in; reviewer receives its link; reviewer asks for a shower-drain close-up and wall distance; John supplies both; reviewer approves that submission. All events appear in order in one task history. Wrong-tenant links and revoked access fail. Failed notifications remain visible, fall back to email, and do not lose the submission.

Implement push subscription management (subscribe, refresh, remove expired endpoints), email fallback, idempotent sending, rate limits, notification preferences and a development inbox for both push and email. Consult current browser and email-provider documentation before enabling live traffic. No real notifications from automated tests.

### Phase 4B — Whereby Embedded live walkthroughs
Implement after Phase 4 and before pilot readiness. Add Request video walkthrough to the task page for authorized reviewers, and a permission-controlled Join button for invited workers/supervisors. Both iPhone Safari and Android Chrome must work without installing an app. Keep a separate-browser join fallback if embedding fails.

Flow: reviewer opens House 12 bathroom rough-in → requests a walkthrough → app creates a private, time-limited room server-side → assigned worker gets a push notification (email fallback) with an app join link → both authenticate or redeem identity-scoped short-lived access and pass task authorization → worker permits camera/microphone and shows the work → reviewer records follow-up notes or requests permanent photo/measurement evidence. Approval remains a separate authenticated action referencing the exact submission; joining or ending a call never approves work.

Use Whereby Embedded as the initial provider behind a small VideoProvider adapter. Read current official room creation, access control, expiry, supported-browser, event/webhook and billing documentation before implementation. Keep API credentials and any host privileges server-side. Do not assume provider links are single-use or identity-bound: enforce app access and use provider access controls where supported. If revocation cannot prevent reuse of a previously issued room link, document that limit and end/rotate the room when necessary. Never put host URLs in worker messages or logs.

Persist session state (requested, ready, active, ended, cancelled, expired, failed), creator, task/submission, invitees, provider reference, expiry and attributed notes. Maintain app request time separately from verified provider join/leave times. Verify and deduplicate provider callbacks where supported, tolerate out-of-order events and reconcile missed events. Unknown attendance/duration stays unknown. Closing a browser or reconnecting must not duplicate sessions or inflate app usage records. Participants may leave separately; ending for everyone must use supported provider controls.

No recording, transcription or live-caption add-ons enabled by default. Do not save call media to app storage or intentionally download video to devices. Browser history/cache and independent screen recording cannot be prohibited or described as impossible. Save only necessary call metadata, notes and separately submitted evidence. Browser media permissions must stop with call termination. Provide rear/front camera switching where supported and test rear-camera focusing, orientation, audio, permission denial, background/lock behavior, poor signal, reconnects and an audio-only fallback.

Usage controls: per-tenant feature toggle, configurable monthly participant-minute allowance, call duration cap, concurrent-call cap, spend alerts and a hard stop on new calls when the configured limit is reached. Design a server-side expiry/end mechanism where supported; UI timers alone cannot enforce provider billing. Record delayed usage and reconciliation uncertainty, reserve usage for active calls, and do not promise a perfect dollar cap from delayed events. Show usage to account admins; provider bills the app account, while any customer recharge/subscription billing is deferred. Joining workers need no paid Whereby subscription.

Budget snapshot checked November 8, 2026: the live official pricing page listed Build at USD 10.99/month including 2,000 participant-minutes, then USD 0.0042 per additional participant-minute, before taxes. Source: https://whereby.com/information/embedded/pricing . Recheck at implementation and keep rates configurable; provider pricing is not a permanent product constant. A two-person 10-minute call is 20 participant-minutes (USD 0.084 incremental usage after the allowance). Estimated shared-account charge = base fee + max(0, total participant-minutes minus included allowance) × overage rate. The included allowance belongs to the provider account, not each app tenant. SMS and app hosting are separate. Exclude paid add-ons from default estimates.

Local development uses simulated rooms, events and usage with obvious demo labels; never silently substitute a fake call for a real one. Live integration acceptance requires configured credentials and real-device testing; otherwise label it unverified. Do not provision paid services merely to run tests.

Acceptance: an authorized contractor and worker on opposite phone platforms join the correct task's call through notification/app links; rear camera can show work; submitted photos/measurements and notes remain on that task; recording stays disabled. Test wrong tenant, unauthorized/revoked user, expired link, leaked worker link, repeated taps, notification failures, camera denial, reconnect, duplicate/out-of-order events, budget limit and provider outage. Evidence upload and task review continue working when video is unavailable. Export session metadata and apply configured retention policies to it.

### Phase 5 — Pilot readiness and operations
Add filters by house/date/company/worker, CSV attendance export and downloadable project evidence export. Implement tested backup restoration, error monitoring, upload/storage quotas, notification cost counters, pagination and archive handling. Retention is configurable by record category and project; do not invent a legally required number of years. Support holds that prevent scheduled deletion, deletion previews, role-restricted execution, and backup expiry policies. Explain to admins which originals/derivatives will be retained or removed.

Pilot on a small number of houses with real workers. Measure repeat check-in effort, missed checkouts, failed uploads, notification delivery, time to review and questions routed incorrectly. Target repeat check-in within about 15 seconds under normal conditions; validate this with users rather than claiming it as guaranteed.

Acceptance: complete end-to-end workflow on iPhone Safari and Android Chrome; poor-network recovery; export and restore verified; tenant isolation checked across database, files and notifications. Report tested concurrency limits rather than claiming unlimited scale.

### Phase 6 — Optional later expansion
Optional SMS notifications through Twilio, once US carrier registration (10DLC or toll-free verification) and TCPA-compliant consent are in place; two-way SMS/MMS replies; additional languages; approved crew check-in; offline synchronization; plan references; inspection checklists; external integrations; advanced analytics. Crew check-in must identify who actually performed the action and avoid implying each worker personally verified presence.

For SMS replies, never attach ambiguous messages to the most recently active task. Use a proven routing strategy such as conversation-specific numbers or explicit task codes; ask for clarification when ambiguous. Preserve provider message IDs, attachments, sender verification context and audit history. Treat delivery as distinct from reading. Keep approval on the authenticated page in the initial release.

## Practical implementation order
Tenant security and identity → project/company chain → printable QR check-in → tasks/photos → review conversation → notifications → Whereby walkthroughs → pilot operations. Location assistance, house codes and reusable sign packs follow once the core flow works. Finish a working vertical slice before adding adjacent features. There is no fixed timeline; acceptance gates determine readiness.

## Required high-value tests
- Tenant isolation for list/detail/search/export endpoints and private objects.
- Role and project restrictions, expired sessions, reused/revoked links.
- Concurrent/duplicate check-ins, midnight/timezone behavior, stale visits and correction audit.
- Project-scoped subcontractor chain, multiple engagements and historical attribution.
- Upload failure/retry, unsupported formats, unauthorized access and submission versioning.
- Notification failure/retry, duplicate provider events and wrong-recipient prevention.
- Reviewer authorization, invalid status transitions and exact-submission approval.
- Configured approval chains (manager-only and multi-level), policy changes mid-review, and contact-policy enforcement upward, downward and sideways.
- One user in two tenants sees no cross-tenant data.
- Task delegation down the chain: supervisors can delegate only within their own part of the chain; delegation history is preserved.
- Invite links: single use, expiry, revocation, and redemption creating only a pending affiliation.
- Passkey and email-link login, recovery, and rejection of fake login mode in production.
- Push delivery, expired subscriptions, email fallback, and the notification center when push is off.
- Per-user language for interface, push and email; translation toggle shows original plus labeled translation; numbers and measurements unchanged; translation failure falls back to the original.
- Full worker → reviewer → follow-up → approval browser flow.
- Video task authorization, token expiry/revocation, event/usage reconciliation, budget enforcement and cross-platform real-device walkthrough.

## Decisions and open items
Copy these into docs/DECISIONS.md during Phase 0.
- Task assignment (decided): the manager assigns to a subcontractor company; its supervisor assigns or delegates down the chain.
- Languages (decided): English, Spanish, Haitian Creole.
- Translation provider: open. Must support all three languages; choose in Phase 0 behind an adapter.
- Market (decided): United States. Imperial units by default, metric optional. US time zones, including zones without daylight saving time. No single federal privacy law applies; treat worker location as sensitive data under state laws (such as California's CCPA/CPRA) and capture explicit consent at check-in. Any SMS requires carrier registration (10DLC or toll-free verification) and TCPA-compliant consent and opt-out.
- Notifications and login (decided): built-in web messenger, web push primary, email backup, passkeys plus email magic links. No business SMS in the first release.
- Providers (decided): Next.js, Supabase, Vercel; Twilio later for optional SMS. Email-sending provider: open, choose in Phase 0. The product owner owns the accounts.
- Phase order (decided): printable QR check-in first; sign packs after tasks/photos.
- Pilot (decided): two general contractors. Their tenants are set up manually; no self-service signup.
- Name (decided): "Project X" as the working name. The domain is still open.
- Native-speaker review of translations: decided later.

## Ready-to-paste Claude implementation prompt

You are a senior full-stack engineer building a construction site accountability application. Read this entire roadmap as the product specification. Work in the provided repository and follow its CLAUDE.md instructions if present.

The repository currently contains only this roadmap. Set up the decided stack: TypeScript, Next.js, Supabase (local development via the Supabase CLI), Vercel-ready configuration, and a notification adapter with web push and email channels. Report any conflict you find in this specification before building on it. Check current official documentation when implementing integrations. Do not invent APIs, provider pricing, legal retention periods, or measurement accuracy.

Implement incrementally in the phase order above. Begin with Phases 0–2: a working foundation, approved identities/company relationships, and check-in by printable property QR code. Tenants for the two pilot contractors are created manually by an operator script or admin screen; there is no public signup. Design the data model to support later task submissions, photos, review conversations, notifications and Whereby walkthroughs without implementing every later feature immediately. Complete each acceptance gate and relevant tests before expanding scope. If the entire first slice cannot fit in one session, finish a coherent tested increment and document the exact continuation point.

Non-negotiable requirements:
1. Browser-based worker flow; no mandatory native app installation.
2. Tenant isolation enforced on every server and file access path.
3. Project-specific, multi-level subcontractor engagement relationships; no global company-parent shortcut.
4. Printable property QR codes are the first check-in method. Location assistance and house codes follow; Phase 2B sign packs (claiming, self-service reassignment, immutable history, assignment-version validation) come after Phase 3. Design the data model so these methods can be added without migrating visit history. Public codes/signs identify properties but are not proof of presence or authorization.
5. Location is captured only at explicit visit events in the initial scope; unavailable/uncertain readings remain visible.
6. Attendance reports say checked in, not guaranteed currently present. Forgotten checkouts remain stale and auditable.
7. Worker completion and contractor approval are separate, versioned, attributable actions.
8. No business SMS in the first release. Login uses passkeys with email magic links; onboarding uses supervisor invite links/QR codes. Notifications go by web push with email fallback, and every notification links to the exact task's built-in conversation, where questions, photos and measurements are exchanged.
9. Private photos, resilient uploads, immutable submission history and server timestamps.
10. Add Whereby Embedded in Phase 4B for task-linked browser walkthroughs on iPhone and Android. Default recording/transcription off; enforce authorization, expiring access, server-side room lifecycle and configurable usage limits. Keep provider secrets server-side, use a simulator locally, and distinguish simulated checks from live-device validation. Save call metadata/notes, not video; approval remains separate.
11. English, Spanish and Haitian Creole from the start, with per-user language. Optional machine translation of user-written text always shows the original next to a labeled translation; the original is authoritative.
12. Contact visibility beyond the always-allowed paths, and the approval chain, are manager-configured policies enforced on the server.
13. Use synthetic demo data, a development inbox for email and push, and a fake translator. Production must reject fake authentication mode. Never send live notifications, provision paid resources or deploy externally merely to run local validation.

Maintain docs/ROADMAP.md with implemented/planned/blocked status, docs/DECISIONS.md with assumptions, and a README with exact setup, migrations, environment variables and verification commands. Never label a mocked provider integration production-ready. Keep credentials out of source control. Prefer simple maintainable modules over speculative infrastructure.

After each increment, report: implemented behavior; files/schema changed; checks run and results; remaining limitations; next dependency-ordered step. Ask questions only when missing information blocks correct implementation; otherwise record reasonable assumptions and continue. Start by inspecting the repository, then implement the first working slice.
