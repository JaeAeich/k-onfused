/**
 * Static vocabulary for the synthetic tool universe.
 * Everything here is data; changing it changes GEN_VERSION.
 *
 * Two disjoint wording banks:
 *   - DESC_* (bank A): third-person, used only in tool descriptions.
 *   - PROMPT_* (bank B): imperative / colloquial, used only in task prompts.
 * gen/tasks.ts asserts zero shared word-3-grams between a prompt and its target description.
 */
import type { JsonSchema } from '../types.js';

export const GEN_VERSION = 'g2';

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------
export type FieldKey =
  | 'title'
  | 'name'
  | 'body'
  | 'priority'
  | 'labels'
  | 'assignee'
  | 'state'
  | 'due_date'
  | 'since'
  | 'changes'
  | 'recipients'
  | 'attendees'
  | 'amount'
  | 'currency'
  | 'until'
  | 'destination'
  | 'email'
  | 'start'
  | 'end'
  | 'severity'
  | 'visibility';

export const FIELDS: Record<FieldKey, JsonSchema> = {
  title: { type: 'string', minLength: 1, description: 'Short human-readable title' },
  name: { type: 'string', minLength: 1, description: 'Unique name' },
  body: { type: 'string', description: 'Free-text body or description' },
  priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
  labels: { type: 'array', items: { type: 'string' }, minItems: 1, description: 'Labels to apply' },
  assignee: {
    type: 'object',
    properties: { email: { type: 'string', format: 'email' }, id: { type: 'string' } },
    required: ['email'],
    additionalProperties: false,
    description: 'Person to assign',
  },
  state: { type: 'string', enum: ['open', 'closed', 'all'] },
  due_date: { type: 'string', format: 'date', description: 'YYYY-MM-DD' },
  since: {
    type: 'string',
    format: 'date',
    description: 'Only items updated on/after this date (YYYY-MM-DD)',
  },
  changes: {
    type: 'object',
    properties: { title: { type: 'string' }, name: { type: 'string' }, body: { type: 'string' } },
    minProperties: 1,
    additionalProperties: false,
    description: 'Fields to change',
  },
  recipients: { type: 'array', items: { type: 'string', format: 'email' }, minItems: 1 },
  attendees: { type: 'array', items: { type: 'string', format: 'email' }, minItems: 1 },
  amount: { type: 'number', exclusiveMinimum: 0, description: 'Amount in major currency units' },
  currency: { type: 'string', enum: ['USD', 'EUR', 'GBP'] },
  until: { type: 'string', format: 'date', description: 'YYYY-MM-DD' },
  destination: { type: 'string', description: 'Target container to move into' },
  email: { type: 'string', format: 'email' },
  start: { type: 'string', format: 'date-time' },
  end: { type: 'string', format: 'date-time' },
  severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
  visibility: { type: 'string', enum: ['private', 'internal', 'public'] },
};

// ---------------------------------------------------------------------------
// Identifiers (how a target-style action locates an existing item)
// ---------------------------------------------------------------------------
export type IdKind = 'id' | 'key' | 'url' | 'name' | 'email';
export const ID_TAG: Record<IdKind, string> = {
  id: 'by_id',
  key: 'by_key',
  url: 'by_url',
  name: 'by_name',
  email: 'by_email',
};
export const ID_DESC: Record<IdKind, string> = {
  id: 'numeric ID',
  key: 'key (e.g. ABC-123)',
  url: 'web URL',
  name: 'name',
  email: 'email address',
};
export const idFieldName = (resource: string, kind: IdKind): string =>
  kind === 'id' ? `${resource}_id` : kind === 'key' ? `${resource}_key` : kind;
export const idFieldSchema = (kind: IdKind): JsonSchema =>
  kind === 'id'
    ? { type: 'string', pattern: '^[0-9]+$' }
    : kind === 'key'
      ? { type: 'string', pattern: '^[A-Z]+-[0-9]+$' }
      : kind === 'url'
        ? { type: 'string', format: 'uri' }
        : kind === 'email'
          ? { type: 'string', format: 'email' }
          : { type: 'string', minLength: 1 };

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
export type ActionMode = 'create' | 'target' | 'list';
export interface Variant {
  tag: string;
  extra: FieldKey[];
}
export interface ActionDef {
  key: string;
  mode: ActionMode;
  /** extra required fields on top of identifier/parent */
  required: FieldKey[];
  optional: FieldKey[];
  /** create/list variants; each adds required fields. Empty tag = base variant. */
  variants: Variant[];
  descVerb: string[]; // bank A
  promptVerb: string[]; // bank B
}
const V = (tag: string, ...extra: FieldKey[]): Variant => ({ tag, extra });
const BASE: Variant[] = [V('')];

export const ACTIONS: Record<string, ActionDef> = {
  create: {
    key: 'create',
    mode: 'create',
    required: [],
    optional: ['body'],
    variants: [V(''), V('prio', 'priority'), V('due', 'due_date'), V('owner', 'assignee')],
    descVerb: ['Creates a', 'Registers a'],
    promptVerb: ['Open', 'File', 'Set up', 'Put together'],
  },
  create_container: {
    key: 'create',
    mode: 'create',
    required: [],
    optional: ['body'],
    variants: [V(''), V('vis', 'visibility')],
    descVerb: ['Creates a', 'Provisions a'],
    promptVerb: ['Set up', 'Spin up', 'Start'],
  },
  create_doc: {
    key: 'create',
    mode: 'create',
    required: [],
    optional: ['body'],
    variants: [V(''), V('shared', 'recipients')],
    descVerb: ['Creates a', 'Drafts a'],
    promptVerb: ['Write up', 'Start', 'Put together'],
  },
  create_event: {
    key: 'create',
    mode: 'create',
    required: ['start'],
    optional: ['end', 'body'],
    variants: [V(''), V('invite', 'attendees')],
    descVerb: ['Schedules a', 'Books a'],
    promptVerb: ['Put', 'Block off', 'Set up'],
  },
  create_payment: {
    key: 'create',
    mode: 'create',
    required: ['amount', 'currency'],
    optional: ['body'],
    variants: [V(''), V('due', 'due_date')],
    descVerb: ['Creates a', 'Issues a'],
    promptVerb: ['Raise', 'Put through', 'Bill'],
  },
  send: {
    key: 'send',
    mode: 'create',
    required: ['body'],
    optional: [],
    variants: BASE,
    descVerb: ['Posts a', 'Sends a'],
    promptVerb: ['Drop', 'Ping', 'Shoot'],
  },
  invite: {
    key: 'invite',
    mode: 'create',
    required: ['email'],
    optional: ['name'],
    variants: BASE,
    descVerb: ['Adds a', 'Invites a'],
    promptVerb: ['Bring', 'Onboard', 'Add'],
  },

  get: {
    key: 'get',
    mode: 'target',
    required: [],
    optional: [],
    variants: BASE,
    descVerb: ['Retrieves a single', 'Returns the details of a'],
    promptVerb: ['Pull up', 'Show me', 'Look up', 'Fetch'],
  },
  update: {
    key: 'update',
    mode: 'target',
    required: ['changes'],
    optional: [],
    variants: BASE,
    descVerb: ['Modifies fields on an existing', 'Edits an existing'],
    promptVerb: ['Change', 'Edit', 'Update'],
  },
  delete: {
    key: 'delete',
    mode: 'target',
    required: [],
    optional: [],
    variants: BASE,
    descVerb: ['Permanently removes a', 'Deletes a'],
    promptVerb: ['Get rid of', 'Trash', 'Drop', 'Nuke'],
  },
  comment: {
    key: 'comment',
    mode: 'target',
    required: ['body'],
    optional: [],
    variants: BASE,
    descVerb: ['Adds a comment to a', 'Appends a note to a'],
    promptVerb: ['Leave a reply on', 'Write on', 'Respond to'],
  },
  assign: {
    key: 'assign',
    mode: 'target',
    required: ['assignee'],
    optional: [],
    variants: BASE,
    descVerb: ['Assigns a', 'Sets the owner of a'],
    promptVerb: ['Hand off', 'Give', 'Route'],
  },
  label: {
    key: 'label',
    mode: 'target',
    required: ['labels'],
    optional: [],
    variants: BASE,
    descVerb: ['Applies labels to a', 'Attaches tags to a'],
    promptVerb: ['Tag', 'Mark', 'Flag'],
  },
  close: {
    key: 'close',
    mode: 'target',
    required: [],
    optional: ['body'],
    variants: BASE,
    descVerb: ['Closes', 'Marks as done'],
    promptVerb: ['Wrap up', 'Shut', 'Finish off'],
  },
  reopen: {
    key: 'reopen',
    mode: 'target',
    required: [],
    optional: [],
    variants: BASE,
    descVerb: ['Reopens a previously closed', 'Restores a closed'],
    promptVerb: ['Bring back', 'Revive', 'Un-close'],
  },
  move: {
    key: 'move',
    mode: 'target',
    required: ['destination'],
    optional: [],
    variants: BASE,
    descVerb: ['Moves a', 'Relocates a'],
    promptVerb: ['Shift', 'Transfer', 'Put'],
  },
  archive: {
    key: 'archive',
    mode: 'target',
    required: [],
    optional: [],
    variants: BASE,
    descVerb: ['Archives', 'Moves to the archive'],
    promptVerb: ['Shelve', 'Retire', 'Stash'],
  },
  share: {
    key: 'share',
    mode: 'target',
    required: ['recipients'],
    optional: [],
    variants: BASE,
    descVerb: ['Shares a', 'Grants access to a'],
    promptVerb: ['Send', 'Pass', 'Let'],
  },
  pin: {
    key: 'pin',
    mode: 'target',
    required: [],
    optional: [],
    variants: BASE,
    descVerb: ['Pins a', 'Sticks a'],
    promptVerb: ['Keep', 'Pin', 'Stick'],
  },
  reply: {
    key: 'reply',
    mode: 'target',
    required: ['body'],
    optional: [],
    variants: BASE,
    descVerb: ['Replies to a', 'Answers a'],
    promptVerb: ['Respond to', 'Write back to', 'Answer'],
  },
  deactivate: {
    key: 'deactivate',
    mode: 'target',
    required: [],
    optional: [],
    variants: BASE,
    descVerb: ['Deactivates a', 'Disables a'],
    promptVerb: ['Turn off', 'Offboard', 'Suspend'],
  },
  cancel: {
    key: 'cancel',
    mode: 'target',
    required: [],
    optional: ['body'],
    variants: BASE,
    descVerb: ['Cancels a', 'Voids a'],
    promptVerb: ['Call off', 'Scrap', 'Kill'],
  },
  refund: {
    key: 'refund',
    mode: 'target',
    required: ['amount'],
    optional: ['body'],
    variants: BASE,
    descVerb: ['Refunds a', 'Returns money for a'],
    promptVerb: ['Give back', 'Reimburse', 'Pay back'],
  },
  acknowledge: {
    key: 'acknowledge',
    mode: 'target',
    required: [],
    optional: [],
    variants: BASE,
    descVerb: ['Acknowledges a', 'Marks as seen a'],
    promptVerb: ['Ack', 'Take ownership of', 'Confirm receipt of'],
  },
  resolve: {
    key: 'resolve',
    mode: 'target',
    required: [],
    optional: ['body'],
    variants: BASE,
    descVerb: ['Resolves a', 'Marks as fixed a'],
    promptVerb: ['Clear', 'Settle', 'Wrap up'],
  },
  snooze: {
    key: 'snooze',
    mode: 'target',
    required: ['until'],
    optional: [],
    variants: BASE,
    descVerb: ['Snoozes a', 'Silences a'],
    promptVerb: ['Mute', 'Quiet', 'Hush'],
  },
  approve: {
    key: 'approve',
    mode: 'target',
    required: [],
    optional: ['body'],
    variants: BASE,
    descVerb: ['Approves a', 'Signs off on a'],
    promptVerb: ['Green-light', 'OK', 'Accept'],
  },
  merge: {
    key: 'merge',
    mode: 'target',
    required: [],
    optional: [],
    variants: BASE,
    descVerb: ['Merges a', 'Integrates a'],
    promptVerb: ['Land', 'Ship', 'Bring in'],
  },

  list: {
    key: 'list',
    mode: 'list',
    required: [],
    optional: [],
    variants: [V(''), V('by_state', 'state'), V('since', 'since')],
    descVerb: ['Lists', 'Enumerates'],
    promptVerb: ['Give me all', 'Show every', 'Pull all', 'What are all'],
  },
  list_simple: {
    key: 'list',
    mode: 'list',
    required: [],
    optional: [],
    variants: [V(''), V('since', 'since')],
    descVerb: ['Lists', 'Enumerates'],
    promptVerb: ['Give me all', 'Show every', 'Pull all'],
  },
};

// ---------------------------------------------------------------------------
// Resource templates
// ---------------------------------------------------------------------------
export interface ParentSpec {
  field: string;
  values: string[];
  descNoun: string;
  promptPhrase: string[]; /* "{v}" placeholder */
}
export interface ResourceTemplate {
  kind: string;
  parent: ParentSpec;
  idKinds: IdKind[];
  /** primary required field on create-like actions */
  createField: FieldKey | null;
  /** action keys into ACTIONS */
  actions: string[];
}

const P = (
  field: string,
  descNoun: string,
  values: string[],
  promptPhrase: string[],
): ParentSpec => ({
  field,
  descNoun,
  values,
  promptPhrase,
});

export const PARENTS = {
  repository: P(
    'repository',
    'repository (owner/name)',
    ['acme/web', 'acme/api', 'orbit/mobile', 'nimbus/infra', 'tidal/docs'],
    ['in the {v} repo', 'inside {v}', 'over in the {v} repository'],
  ),
  project_key: P(
    'project_key',
    'project key',
    ['WEB', 'API', 'MOB', 'INFRA', 'OPS'],
    ['in project {v}', 'under the {v} project', 'on the {v} board'],
  ),
  organization: P(
    'organization',
    'organization',
    ['acme', 'orbit', 'nimbus', 'tidal'],
    ['for the {v} org', 'under {v}', 'in the {v} organization'],
  ),
  channel: P(
    'channel',
    'channel',
    ['#deploys', '#incidents', '#general', '#design', '#random'],
    ['in {v}', 'over in {v}', 'to the {v} channel'],
  ),
  workspace: P(
    'workspace',
    'workspace',
    ['Engineering', 'Design', 'Sales', 'People Ops'],
    ['in the {v} workspace', 'inside {v}', 'in our {v} space'],
  ),
  folder: P(
    'folder',
    'folder',
    ['Q3 Planning', 'Contracts', 'Design Assets', 'Onboarding'],
    ['in the {v} folder', 'inside {v}', 'under {v}'],
  ),
  account: P(
    'account',
    'account',
    ['Globex', 'Initech', 'Umbrella', 'Vandelay'],
    ['for the {v} account', 'at {v}', 'on the {v} account'],
  ),
  pipeline: P(
    'pipeline',
    'pipeline',
    ['Enterprise', 'SMB', 'Renewals', 'Partnerships'],
    ['in the {v} pipeline', 'on {v}', 'inside the {v} pipeline'],
  ),
  customer_id: P(
    'customer_id',
    'customer ID',
    ['cus_8f2k1', 'cus_m3x9q', 'cus_p0a7z', 'cus_t5l2w'],
    ['for customer {v}', 'on customer {v}', 'against customer {v}'],
  ),
  service: P(
    'service',
    'service',
    ['checkout-api', 'auth-service', 'search-worker', 'billing-cron'],
    ['on {v}', 'for the {v} service', 'coming from {v}'],
  ),
  mailbox: P(
    'mailbox',
    'mailbox',
    ['support@acme.com', 'billing@acme.com', 'hello@acme.com'],
    ['from {v}', 'out of the {v} inbox', 'via {v}'],
  ),
  calendar: P(
    'calendar',
    'calendar',
    ['Team Calendar', 'On-call', 'Interviews', 'Personal'],
    ['on the {v} calendar', 'in {v}', 'onto {v}'],
  ),
  department: P(
    'department',
    'department',
    ['Engineering', 'Marketing', 'Finance', 'Support'],
    ['in {v}', 'for the {v} department', 'within {v}'],
  ),
  store: P(
    'store',
    'store',
    ['acme-outlet', 'orbit-goods', 'nimbus-shop'],
    ['in the {v} store', 'on {v}', 'for the {v} shop'],
  ),
  ticket: P(
    'ticket_key',
    'parent ticket key',
    ['WEB-231', 'API-77', 'MOB-412', 'OPS-9'],
    ['on {v}', 'under {v}', 'against {v}'],
  ),
  file: P('file_id', 'file ID', ['48213', '90177', '31005'], ['on file {v}', 'against file {v}']),
};

const T = (
  kind: string,
  parent: ParentSpec,
  idKinds: IdKind[],
  createField: FieldKey | null,
  actions: string[],
): ResourceTemplate => ({ kind, parent, idKinds, createField, actions });

export const TEMPLATES = {
  work_item: (parent: ParentSpec, idKinds: IdKind[] = ['id', 'key', 'url']) =>
    T('work_item', parent, idKinds, 'title', [
      'create',
      'get',
      'update',
      'delete',
      'list',
      'comment',
      'assign',
      'label',
      'close',
      'reopen',
      'move',
    ]),
  pull_request: (parent: ParentSpec) =>
    T('pull_request', parent, ['id', 'url'], 'title', [
      'create',
      'get',
      'update',
      'list',
      'comment',
      'assign',
      'label',
      'close',
      'approve',
      'merge',
    ]),
  container: (parent: ParentSpec) =>
    T('container', parent, ['id', 'name', 'url'], 'name', [
      'create_container',
      'get',
      'update',
      'delete',
      'list_simple',
      'archive',
    ]),
  message: (parent: ParentSpec) =>
    T('message', parent, ['id', 'url'], 'body', ['send', 'get', 'delete', 'list', 'pin', 'reply']),
  document: (parent: ParentSpec) =>
    T('document', parent, ['id', 'url', 'name'], 'title', [
      'create_doc',
      'get',
      'update',
      'delete',
      'list_simple',
      'archive',
      'share',
      'move',
    ]),
  person: (parent: ParentSpec) =>
    T('person', parent, ['id', 'email'], 'email', [
      'invite',
      'get',
      'update',
      'list_simple',
      'deactivate',
    ]),
  event: (parent: ParentSpec) =>
    T('event', parent, ['id'], 'title', [
      'create_event',
      'get',
      'update',
      'delete',
      'list_simple',
      'cancel',
    ]),
  payment: (parent: ParentSpec) =>
    T('payment', parent, ['id'], null, ['create_payment', 'get', 'list', 'refund', 'cancel']),
  alert: (parent: ParentSpec) =>
    T('alert', parent, ['id', 'key'], null, [
      'get',
      'list',
      'acknowledge',
      'resolve',
      'snooze',
      'assign',
      'comment',
    ]),
  request: (parent: ParentSpec) =>
    // e.g. time-off request: create/get/approve/list/cancel
    T('request', parent, ['id'], 'title', ['create', 'get', 'list', 'approve', 'cancel']),
};

// ---------------------------------------------------------------------------
// Categories, vendors, resources
// ---------------------------------------------------------------------------
export interface ResourceSpec {
  /** snake_case resource name used in tool names */
  name: string;
  /** singular noun for descriptions (bank A) */
  noun: string;
  /** colloquial aliases for prompts (bank B); falls back to noun */
  aliases: string[];
  template: ResourceTemplate;
}
export interface Category {
  key: string;
  realVendors: { key: string; display: string }[];
  fictionalVendors: string[];
  resources: ResourceSpec[];
}
const R = (
  name: string,
  template: ResourceTemplate,
  aliases: string[] = [],
  noun = name.replace(/_/g, ' '),
): ResourceSpec => ({ name, noun, aliases: aliases.length ? aliases : [noun], template });
const RV = (key: string, display: string) => ({ key, display });

export const CATEGORIES: Category[] = [
  {
    key: 'vcs',
    realVendors: [
      RV('github', 'GitHub'),
      RV('gitlab', 'GitLab'),
      RV('bitbucket', 'Bitbucket'),
      RV('gitea', 'Gitea'),
    ],
    fictionalVendors: [
      'codeforge',
      'mergeline',
      'repohub',
      'branchly',
      'commitbay',
      'gitnest',
      'forkstream',
      'pushpoint',
      'stackgit',
      'codebay',
      'revline',
      'patchwise',
      'gitwave',
      'sourcely',
      'mergehub',
      'commitly',
      'branchbay',
      'diffnest',
      'repowise',
      'forgeline',
      'gitforge',
      'codenest',
      'pullbay',
      'vcsly',
    ],
    resources: [
      R('issue', TEMPLATES.work_item(PARENTS.repository, ['id', 'url']), [
        'bug report',
        'problem report',
      ]),
      R('pull_request', TEMPLATES.pull_request(PARENTS.repository), ['PR', 'code change']),
      R('repository', TEMPLATES.container(PARENTS.organization), ['repo', 'codebase']),
      R('release', TEMPLATES.document(PARENTS.repository), ['version drop', 'build release']),
      R('milestone', TEMPLATES.request(PARENTS.repository), ['target', 'goalpost']),
      R('collaborator', TEMPLATES.person(PARENTS.repository), ['contributor', 'teammate']),
      R('branch', TEMPLATES.container(PARENTS.repository), ['feature branch', 'ref']),
      R('workflow_run', TEMPLATES.alert(PARENTS.repository), ['CI run', 'pipeline execution']),
    ],
  },
  {
    key: 'issue_tracker',
    realVendors: [
      RV('jira', 'Jira'),
      RV('linear', 'Linear'),
      RV('asana', 'Asana'),
      RV('trello', 'Trello'),
    ],
    fictionalVendors: [
      'trackly',
      'bugloop',
      'ticketwise',
      'taskforge',
      'issuehub',
      'boardly',
      'sprintline',
      'planwise',
      'tasknest',
      'bugbay',
      'issuely',
      'trackbay',
      'workline',
      'kanbanly',
      'backlogr',
      'sprintly',
      'boardnest',
      'ticketbay',
      'planforge',
      'taskwave',
      'tracknest',
      'issuewise',
      'cardline',
      'epicbay',
    ],
    resources: [
      R('ticket', TEMPLATES.work_item(PARENTS.project_key), ['bug', 'work item', 'card']),
      R('epic', TEMPLATES.work_item(PARENTS.project_key), ['big initiative', 'umbrella item']),
      R('sprint', TEMPLATES.container(PARENTS.project_key), ['iteration', 'cycle']),
      R('project', TEMPLATES.container(PARENTS.organization), ['board', 'space']),
      R('comment', TEMPLATES.message(PARENTS.ticket), ['note', 'remark']),
      R('member', TEMPLATES.person(PARENTS.project_key), ['teammate', 'collaborator']),
      R('label', TEMPLATES.container(PARENTS.project_key), ['tag', 'category']),
      R('attachment', TEMPLATES.document(PARENTS.ticket), ['attached file', 'upload']),
    ],
  },
  {
    key: 'chat',
    realVendors: [
      RV('slack', 'Slack'),
      RV('discord', 'Discord'),
      RV('teams', 'Microsoft Teams'),
      RV('mattermost', 'Mattermost'),
    ],
    fictionalVendors: [
      'chatly',
      'pingroom',
      'talkbase',
      'huddleup',
      'msgflow',
      'channelo',
      'roomlink',
      'waveline',
      'chatnest',
      'pingbay',
      'talkwise',
      'huddly',
      'msgnest',
      'roomly',
      'wavechat',
      'chatforge',
      'pingline',
      'talkbay',
      'threadly',
      'channely',
      'chatwave',
      'huddlebay',
      'roomwise',
      'msgbay',
    ],
    resources: [
      R('message', TEMPLATES.message(PARENTS.channel), ['note', 'msg', 'post']),
      R('channel', TEMPLATES.container(PARENTS.workspace), ['room', 'chat group']),
      R('user', TEMPLATES.person(PARENTS.workspace), ['person', 'teammate']),
      R('reminder', TEMPLATES.event(PARENTS.channel), ['nudge', 'heads-up']),
      R('file', TEMPLATES.document(PARENTS.channel), ['attachment', 'upload']),
      R('thread', TEMPLATES.message(PARENTS.channel), ['conversation', 'discussion']),
      R('webhook', TEMPLATES.container(PARENTS.workspace), ['integration hook', 'callback']),
    ],
  },
  {
    key: 'crm',
    realVendors: [
      RV('salesforce', 'Salesforce'),
      RV('hubspot', 'HubSpot'),
      RV('pipedrive', 'Pipedrive'),
      RV('zoho', 'Zoho CRM'),
    ],
    fictionalVendors: [
      'leadnest',
      'dealflow',
      'clientbase',
      'saleslink',
      'contactly',
      'pipewise',
      'crmbay',
      'prospecto',
      'leadbay',
      'dealnest',
      'cliently',
      'salesnest',
      'contactbay',
      'pipenest',
      'crmwise',
      'prospectly',
      'leadwise',
      'dealbay',
      'clientwave',
      'saleswave',
      'contactnest',
      'pipebay',
      'crmline',
      'leadline',
    ],
    resources: [
      R('contact', TEMPLATES.person(PARENTS.account), ['person', 'point of contact']),
      R('lead', TEMPLATES.person(PARENTS.pipeline), ['prospect', 'potential customer']),
      R('deal', TEMPLATES.work_item(PARENTS.pipeline, ['id', 'url']), [
        'opportunity',
        'sale in progress',
      ]),
      R('account', TEMPLATES.container(PARENTS.organization), ['company record', 'client org']),
      R('note', TEMPLATES.message(PARENTS.account), ['memo', 'jotting']),
      R('task', TEMPLATES.request(PARENTS.pipeline), ['to-do', 'follow-up']),
      R('campaign', TEMPLATES.request(PARENTS.pipeline), ['outreach push', 'marketing drive']),
      R('meeting', TEMPLATES.event(PARENTS.account), ['call', 'sync']),
    ],
  },
  {
    key: 'payments',
    realVendors: [
      RV('stripe', 'Stripe'),
      RV('paypal', 'PayPal'),
      RV('square', 'Square'),
      RV('adyen', 'Adyen'),
    ],
    fictionalVendors: [
      'paybase',
      'chargely',
      'billflow',
      'ledgerly',
      'cashline',
      'invoicely',
      'paywise',
      'transactly',
      'paynest',
      'chargebay',
      'billwise',
      'ledgerbay',
      'cashnest',
      'invoicebay',
      'paywave',
      'paybridge',
      'chargewise',
      'billnest',
      'ledgerwise',
      'cashwave',
      'invoicenest',
      'payline',
      'chargeline',
      'billbay',
    ],
    resources: [
      R('charge', TEMPLATES.payment(PARENTS.customer_id), ['payment', 'card charge']),
      R('invoice', TEMPLATES.payment(PARENTS.customer_id), ['bill', 'statement']),
      R('subscription', TEMPLATES.payment(PARENTS.customer_id), ['recurring plan', 'membership']),
      R('customer', TEMPLATES.person(PARENTS.account), ['payer', 'buyer']),
      R('payout', TEMPLATES.payment(PARENTS.account), ['transfer out', 'disbursement']),
      R('dispute', TEMPLATES.alert(PARENTS.customer_id), ['chargeback', 'contested payment']),
      R('coupon', TEMPLATES.request(PARENTS.account), ['promo code', 'voucher']),
    ],
  },
  {
    key: 'storage',
    realVendors: [
      RV('dropbox', 'Dropbox'),
      RV('box', 'Box'),
      RV('gdrive', 'Google Drive'),
      RV('onedrive', 'OneDrive'),
    ],
    fictionalVendors: [
      'filebay',
      'cloudnest',
      'docvault',
      'storely',
      'sharebin',
      'foldera',
      'syncwise',
      'driveline',
      'filenest',
      'cloudbay',
      'docnest',
      'storewise',
      'sharewise',
      'foldernest',
      'syncbay',
      'drivebay',
      'filewave',
      'cloudwise',
      'docline',
      'storebay',
      'sharenest',
      'folderbay',
      'syncline',
      'drivenest',
    ],
    resources: [
      R('file', TEMPLATES.document(PARENTS.folder), ['doc', 'upload']),
      R('folder', TEMPLATES.container(PARENTS.workspace), ['directory', 'bucket']),
      R('comment', TEMPLATES.message(PARENTS.file), ['annotation', 'remark']),
      R('share_link', TEMPLATES.document(PARENTS.folder), ['public link', 'shareable URL']),
      R('collaborator', TEMPLATES.person(PARENTS.folder), ['editor', 'teammate']),
      R('version', TEMPLATES.document(PARENTS.file), ['revision', 'snapshot']),
      R('upload_job', TEMPLATES.request(PARENTS.folder), ['chunked upload', 'transfer job']),
    ],
  },
  {
    key: 'monitoring',
    realVendors: [
      RV('datadog', 'Datadog'),
      RV('pagerduty', 'PagerDuty'),
      RV('grafana', 'Grafana'),
      RV('sentry', 'Sentry'),
    ],
    fictionalVendors: [
      'alertly',
      'watchdog',
      'metricbay',
      'uptimely',
      'signalnest',
      'pulsewise',
      'tracely',
      'monitorly',
      'alertbay',
      'watchwise',
      'metricnest',
      'uptimebay',
      'signalbay',
      'pulsenest',
      'tracenest',
      'monitorbay',
      'alertwave',
      'watchnest',
      'metricline',
      'uptimewise',
      'signalwave',
      'pulsebay',
      'traceline',
      'oncallly',
    ],
    resources: [
      R('alert', TEMPLATES.alert(PARENTS.service), ['page', 'alarm']),
      R('incident', TEMPLATES.alert(PARENTS.service), ['outage', 'sev']),
      R('monitor', TEMPLATES.container(PARENTS.service), ['check', 'probe']),
      R('dashboard', TEMPLATES.document(PARENTS.workspace), ['board', 'metrics view']),
      R('on_call_shift', TEMPLATES.event(PARENTS.calendar), ['rotation slot', 'pager duty']),
      R('silence', TEMPLATES.event(PARENTS.service), ['mute window', 'quiet period']),
      R('runbook', TEMPLATES.document(PARENTS.service), ['playbook', 'response guide']),
    ],
  },
  {
    key: 'email',
    realVendors: [
      RV('gmail', 'Gmail'),
      RV('outlook', 'Outlook'),
      RV('sendgrid', 'SendGrid'),
      RV('mailchimp', 'Mailchimp'),
    ],
    fictionalVendors: [
      'mailbay',
      'inboxly',
      'sendwise',
      'postline',
      'mailnest',
      'campaigno',
      'letterbox',
      'dispatchly',
      'mailwise',
      'inboxbay',
      'sendnest',
      'postbay',
      'mailwave',
      'campaignly',
      'letterbay',
      'dispatchwise',
      'mailline',
      'inboxnest',
      'sendbay',
      'postwise',
      'newsly',
      'blastbay',
      'letternest',
      'dispatchbay',
    ],
    resources: [
      R('email', TEMPLATES.message(PARENTS.mailbox), ['mail', 'note']),
      R('draft', TEMPLATES.document(PARENTS.mailbox), ['unsent mail', 'work-in-progress email']),
      R('label', TEMPLATES.container(PARENTS.mailbox), ['tag', 'category']),
      R('contact', TEMPLATES.person(PARENTS.mailbox), ['address book entry', 'recipient']),
      R('campaign', TEMPLATES.request(PARENTS.mailbox), ['mail blast', 'newsletter send']),
      R('signature', TEMPLATES.document(PARENTS.mailbox), ['sign-off block', 'footer']),
      R('filter', TEMPLATES.container(PARENTS.mailbox), ['rule', 'auto-sort rule']),
    ],
  },
  {
    key: 'calendar',
    realVendors: [
      RV('gcal', 'Google Calendar'),
      RV('outlook_cal', 'Outlook Calendar'),
      RV('calendly', 'Calendly'),
      RV('fantastical', 'Fantastical'),
    ],
    fictionalVendors: [
      'meetly',
      'slotwise',
      'timenest',
      'bookline',
      'agendly',
      'planbay',
      'schedulo',
      'daybook',
      'meetbay',
      'slotnest',
      'timebay',
      'booknest',
      'agendabay',
      'plannest',
      'schedwise',
      'daybay',
      'meetnest',
      'slotbay',
      'timewise',
      'bookwise',
      'agendanest',
      'planline',
      'schedbay',
      'daynest',
    ],
    resources: [
      R('event', TEMPLATES.event(PARENTS.calendar), ['meeting', 'appointment']),
      R('calendar', TEMPLATES.container(PARENTS.workspace), ['schedule', 'agenda']),
      R('booking', TEMPLATES.event(PARENTS.calendar), ['reserved slot', 'appointment']),
      R('attendee', TEMPLATES.person(PARENTS.calendar), ['guest', 'participant']),
      R('reminder', TEMPLATES.event(PARENTS.calendar), ['nudge', 'heads-up']),
      R('free_slot', TEMPLATES.event(PARENTS.calendar), ['open window', 'availability block']),
      R('room', TEMPLATES.container(PARENTS.workspace), ['meeting room', 'space']),
    ],
  },
  {
    key: 'docs',
    realVendors: [
      RV('notion', 'Notion'),
      RV('confluence', 'Confluence'),
      RV('coda', 'Coda'),
      RV('gdocs', 'Google Docs'),
    ],
    fictionalVendors: [
      'noteforge',
      'pagenest',
      'wikily',
      'docbay',
      'writewise',
      'knowly',
      'scriblet',
      'pageline',
      'notebay',
      'pagewise',
      'wikibay',
      'docwave',
      'writenest',
      'knowbay',
      'scribbay',
      'pagebay',
      'notewise',
      'wikinest',
      'docforge',
      'writebay',
      'knownest',
      'scribnest',
      'pagewave',
      'notenest',
    ],
    resources: [
      R('page', TEMPLATES.document(PARENTS.workspace), ['doc', 'write-up']),
      R('database', TEMPLATES.container(PARENTS.workspace), ['table', 'collection']),
      R('comment', TEMPLATES.message(PARENTS.file), ['remark', 'annotation']),
      R('workspace', TEMPLATES.container(PARENTS.organization), ['team space', 'hub']),
      R('template', TEMPLATES.document(PARENTS.workspace), ['boilerplate', 'starter']),
      R('member', TEMPLATES.person(PARENTS.workspace), ['teammate', 'editor']),
      R('bookmark', TEMPLATES.document(PARENTS.workspace), ['saved link', 'pin']),
      R('tag', TEMPLATES.container(PARENTS.workspace), ['label', 'category']),
    ],
  },
  {
    key: 'hr',
    realVendors: [
      RV('workday', 'Workday'),
      RV('bamboohr', 'BambooHR'),
      RV('gusto', 'Gusto'),
      RV('rippling', 'Rippling'),
    ],
    fictionalVendors: [
      'peoplely',
      'staffbay',
      'hirewise',
      'teamnest',
      'payrollo',
      'onboardly',
      'leaveline',
      'rosterly',
      'peoplebay',
      'staffwise',
      'hirebay',
      'teambay',
      'payrollbay',
      'onboardnest',
      'leavebay',
      'rosterbay',
      'peoplenest',
      'staffnest',
      'hirenest',
      'teamwise',
      'payrollwise',
      'onboardbay',
      'leavenest',
      'rosterwise',
    ],
    resources: [
      R('employee', TEMPLATES.person(PARENTS.department), ['staff member', 'hire']),
      R('time_off', TEMPLATES.request(PARENTS.department), ['PTO ask', 'leave request']),
      R('job_posting', TEMPLATES.document(PARENTS.department), ['open role', 'vacancy']),
      R('candidate', TEMPLATES.person(PARENTS.department), ['applicant', 'interviewee']),
      R('department', TEMPLATES.container(PARENTS.organization), ['team', 'unit']),
      R('perf_review', TEMPLATES.document(PARENTS.department), ['eval', 'appraisal']),
      R('onboard_task', TEMPLATES.request(PARENTS.department), [
        'new-hire to-do',
        'starter checklist item',
      ]),
      R('payslip', TEMPLATES.document(PARENTS.department), ['pay stub', 'salary statement']),
    ],
  },
  {
    key: 'ecommerce',
    realVendors: [
      RV('shopify', 'Shopify'),
      RV('woocommerce', 'WooCommerce'),
      RV('bigcommerce', 'BigCommerce'),
      RV('magento', 'Magento'),
    ],
    fictionalVendors: [
      'shopbay',
      'cartwise',
      'storenest',
      'orderline',
      'sellwise',
      'merchly',
      'checkoutly',
      'productbay',
      'shopnest',
      'cartbay',
      'storewave',
      'orderbay',
      'sellbay',
      'merchbay',
      'checkoutbay',
      'productnest',
      'shopwise',
      'cartnest',
      'storeline',
      'ordernest',
      'sellnest',
      'merchnest',
      'checkoutwise',
      'productwise',
    ],
    resources: [
      R('product', TEMPLATES.document(PARENTS.store), ['item', 'SKU listing']),
      R('order', TEMPLATES.payment(PARENTS.customer_id), ['purchase', 'checkout']),
      R('customer', TEMPLATES.person(PARENTS.store), ['shopper', 'buyer']),
      R('discount', TEMPLATES.request(PARENTS.store), ['promo', 'coupon']),
      R('collection', TEMPLATES.container(PARENTS.store), ['catalog section', 'product group']),
      R('shipment', TEMPLATES.alert(PARENTS.customer_id), ['delivery', 'parcel']),
      R('review', TEMPLATES.message(PARENTS.store), ['rating', 'customer feedback']),
    ],
  },
];

export const EDITIONS: { key: string; display: string }[] = [
  { key: '', display: '' },
  { key: 'cloud', display: 'Cloud' },
  { key: 'enterprise', display: 'Enterprise' },
  { key: 'eu', display: 'EU' },
  { key: 'v2', display: 'v2' },
  { key: 'us', display: 'US' },
];

// ---------------------------------------------------------------------------
// Bank A helpers (descriptions)
// ---------------------------------------------------------------------------
export const DESC_OPTIONAL = ['Optionally accepts', 'Also supports the optional fields'];
export const DESC_LIST_VARIANT: Record<string, string> = {
  '': '',
  by_state: ', filtered by state',
  since: ' that changed after a given date',
};
export const DESC_CREATE_VARIANT: Record<string, string> = {
  '': '',
  prio: ' with an explicit priority level',
  due: ' with a deadline',
  owner: ' and assigns it to someone',
  vis: ' with a chosen visibility',
  shared: ' and grants access to recipients',
  invite: ' and invites attendees',
};

// ---------------------------------------------------------------------------
// Bank B helpers (prompts)
// ---------------------------------------------------------------------------
export const PROMPT_APP = ['on {app}', 'in {app}', 'using {app}', 'via {app}'];
export const PROMPT_ID: Record<IdKind, string[]> = {
  id: ['the {alias} with id {v}', '{alias} number {v}', '{alias} {v}'],
  key: ['{alias} {v}', 'the {alias} {v}'],
  url: ['the {alias} at {v}', 'this {alias}: {v}'],
  name: ["the {alias} called '{v}'", "the '{v}' {alias}"],
  email: ['the {alias} {v}', '{alias} with address {v}'],
};
export const PROMPT_FIELD: Record<FieldKey, string[]> = {
  title: ['titled "{v}"', 'called "{v}"', 'with the heading "{v}"'],
  name: ['called "{v}"', 'named "{v}"'],
  body: ['saying "{v}"', 'with the text "{v}"', 'that reads "{v}"'],
  priority: ['at {v} priority', 'and mark it {v} priority', 'as {v} priority'],
  labels: ['and slap on the labels {v}', 'with labels {v}', 'tagged {v}'],
  assignee: ['and put {v} on it', 'owned by {v}', 'to {v}'],
  state: ['that are {v}', 'in {v} state', 'currently {v}'],
  due_date: ['due {v}', 'with a deadline of {v}', 'to be done by {v}'],
  since: ['touched after {v}', 'changed from {v} onward', 'updated after {v}'],
  changes: ['to "{v}"'], // unused: see PROMPT_CHANGES
  recipients: ['with {v}', 'so {v} can see it', 'to {v}'],
  attendees: ['with {v} invited', 'and loop in {v}', 'along with {v}'],
  amount: ['for {v}', 'worth {v}', 'of {v}'],
  currency: ['{v}', 'in {v}'],
  until: ['until {v}', 'through {v}', 'till {v}'],
  destination: ['over to {v}', 'into {v}', 'across to {v}'],
  email: ['{v}', 'at {v}', 'with email {v}'],
  start: ['starting {v}', 'kicking off at {v}', 'from {v}'],
  end: ['ending {v}', 'wrapping at {v}', 'until {v}'],
  severity: ['at {v} severity', 'as {v}'],
  visibility: ['and make it {v}', 'set to {v}', 'with {v} access'],
};

/** update-action wording depends on whether the object has a title (work items, docs) or a name (people, containers) */
export const PROMPT_CHANGES = {
  title: ['so its heading becomes "{v}"', 'to be titled "{v}"', 'so the title reads "{v}"'],
  name: ['to be called "{v}"', 'so its name becomes "{v}"', 'renaming it to "{v}"'],
};

// Value pools (bank-neutral data)
export const POOL = {
  titles: [
    'Login page crashes on submit',
    'Add dark mode toggle',
    'Checkout total is off by one cent',
    'Rotate API keys quarterly',
    'Migrate CI to arm64 runners',
    'Onboarding email has broken link',
    'Search results ignore filters',
    'Upgrade Postgres to 16',
    'Mobile nav overlaps header',
    'Export report as CSV',
  ],
  bodies: [
    'Repro steps attached in the thread',
    'Blocked until infra signs off',
    'Needs design review first',
    'Customer escalated this twice',
    'Low risk, no migration needed',
  ],
  names: [
    'deploys',
    'platform-core',
    'q4-launch',
    'design-system',
    'growth-experiments',
    'ops-runbooks',
  ],
  emails: ['maya@acme.com', 'jordan@acme.com', 'sam@orbit.dev', 'priya@nimbus.io', 'lee@tidal.co'],
  labels: ['bug', 'frontend', 'backend', 'p1', 'needs-triage', 'infra', 'docs', 'good-first-issue'],
  dates: ['2026-10-03', '2026-10-15', '2026-11-01', '2026-11-20', '2026-12-05'],
  datetimes: [
    '2026-10-03T14:00:00Z',
    '2026-10-07T09:30:00Z',
    '2026-10-12T16:00:00Z',
    '2026-10-21T11:00:00Z',
  ],
  amounts: [49.99, 120, 15.5, 899, 32],
  keysPrefix: ['WEB', 'API', 'MOB', 'OPS', 'INFRA'],
};

export const STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'in',
  'on',
  'of',
  'to',
  'for',
  'with',
  'by',
  'its',
  'it',
  'and',
  'or',
  'is',
  'are',
  'from',
  'that',
  'this',
  'as',
  'at',
  'be',
  'into',
  'all',
  'requires',
  'optionally',
  'accepts',
  'also',
  'supports',
  'optional',
  'fields',
  'me',
  'i',
  'please',
  'so',
  'up',
  'out',
  'off',
]);
