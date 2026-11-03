"""Assembles n8n/bookleaf-royalty-summary.json from the Code-node sources in n8n/src/.

Keeping the JavaScript in real .js files makes it reviewable and testable; this script places it into the
n8n workflow export format. Run from the repo root:  python3 tools/build_workflow.py
"""
import json
import pathlib
import uuid

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / 'n8n' / 'src'
code = lambda f: (SRC / f).read_text(encoding='utf-8')
uid = lambda name: str(uuid.uuid5(uuid.NAMESPACE_URL, f'bookleaf-a2/{name}'))

WEBHOOK_CRED = {'httpHeaderAuth': {'id': 'bookleafWebhookKey', 'name': 'BookLeaf webhook key (X-BookLeaf-Key)'}}
AI_CRED = {'httpHeaderAuth': {'id': 'bookleafAiKey', 'name': 'AI API key (Authorization: Bearer)'}}
BUBBLE_CRED = {'httpHeaderAuth': {'id': 'bookleafBubbleToken', 'name': 'Bubble API token (Authorization: Bearer)'}}
SMTP_CRED = {'smtp': {'id': 'bookleafSmtp', 'name': 'SMTP account'}}


def node(name, type_, version, pos, params, **extra):
    n = {'parameters': params, 'id': uid(name), 'name': name, 'type': type_, 'typeVersion': version, 'position': pos}
    n.update(extra)
    return n


def code_node(name, file, pos, **extra):
    return node(name, 'n8n-nodes-base.code', 2, pos, {'jsCode': code(file)}, **extra)


def if_node(name, pos, left, operation='true'):
    return node(name, 'n8n-nodes-base.if', 2, pos, {
        'conditions': {
            'options': {'caseSensitive': True, 'leftValue': '', 'typeValidation': 'loose'},
            'conditions': [{
                'id': uid(name + '/c'),
                'leftValue': left,
                'rightValue': '',
                'operator': {'type': 'boolean', 'operation': operation, 'singleValue': True},
            }],
            'combinator': 'and',
        },
        'options': {},
    })


def respond(name, pos):
    return node(name, 'n8n-nodes-base.respondToWebhook', 1.1, pos, {
        'respondWith': 'json',
        'responseBody': '={{ JSON.stringify($json.response) }}',
        'options': {'responseCode': '={{ $json.http_code || 200 }}'},
    })


def sticky(name, pos, text, w=380, h=200, color=7):
    return node(name, 'n8n-nodes-base.stickyNote', 1, pos, {'content': text, 'width': w, 'height': h, 'color': color})


nodes = [
    sticky('About this workflow', [-120, -360], (
        '## BookLeaf · AI royalty summary\n'
        'Bubble calls the webhook with one author\'s data → we validate, de-duplicate, compute the payout facts in code, '
        'ask the AI for the email, fact-check it, and **answer the same HTTP call** with Success / Failed / Duplicate. '
        'Bubble writes that answer into its Notification Log.\n\n'
        'Edit settings in **Settings (edit me)**. Secrets live in Credentials: webhook key, AI key, optional SMTP and Bubble token.'
    ), w=560, h=220, color=5),
    sticky('Failure path note', [1500, 420], (
        '### Every failure ends in a response\n'
        'Invalid payload (400), duplicate, AI API error (after 2 tries) and a failed fact-check all go to '
        '**Build failure response**, so Bubble is never left waiting and the log records *why*.'
    ), w=420, h=170, color=3),
    node('Webhook from Bubble', 'n8n-nodes-base.webhook', 2, [0, 0], {
        'httpMethod': 'POST',
        'path': 'bookleaf/royalty-summary',
        'authentication': 'headerAuth',
        'responseMode': 'responseNode',
        'options': {},
    }, webhookId=uid('webhook'), credentials=WEBHOOK_CRED),
    code_node('Settings (edit me)', '01_settings.js', [220, 0]),
    code_node('Validate payload', '02_validate.js', [440, 0]),
    if_node('Payload valid?', [660, 0], '={{ $json.ok }}'),
    code_node('De-duplicate', '03_dedupe.js', [880, -120]),
    if_node('Duplicate?', [1100, -120], '={{ $json.duplicate }}'),
    code_node('Compute royalty facts', '04_facts.js', [1320, -200]),
    code_node('Build AI prompt', '05_prompt.js', [1540, -200]),
    node('Call AI (chat completions)', 'n8n-nodes-base.httpRequest', 4.2, [1760, -200], {
        'method': 'POST',
        'url': '={{ $json.ai_url }}',
        'authentication': 'genericCredentialType',
        'genericAuthType': 'httpHeaderAuth',
        'sendBody': True,
        'specifyBody': 'json',
        'jsonBody': '={{ JSON.stringify($json.ai_request) }}',
        'options': {'timeout': 25000},
    }, credentials=AI_CRED, retryOnFail=True, maxTries=2, waitBetweenTries=3000, onError='continueErrorOutput'),
    code_node('Fact-check AI email', '06_check_email.js', [1980, -280]),
    if_node('Email passed checks?', [2200, -280], '={{ $json.ok }}'),
    if_node('Send real email? (bonus)', [2420, -360], "={{ $('Validate payload').first().json.settings.send_email }}"),
    node('Send email (SMTP)', 'n8n-nodes-base.emailSend', 2.1, [2640, -460], {
        'fromEmail': 'royalties@bookleaf-demo.example',
        'toEmail': "={{ $('Validate payload').first().json.settings.test_recipient }}",
        'subject': '={{ $json.subject }}',
        'emailFormat': 'text',
        'text': '={{ $json.body }}',
        'options': {},
    }, credentials=SMTP_CRED, onError='continueRegularOutput'),
    code_node('Build success response', '07_success.js', [2860, -360]),
    respond('Respond: Success', [3080, -360]),
    code_node('Build failure response', '08_failure.js', [2420, 160]),
    respond('Respond: Failed', [2640, 160]),
    if_node('Bubble callback enabled?', [3300, -100], "={{ $('Validate payload').first().json.settings.bubble_callback }}"),
    node('Update Bubble Notification Log (Data API)', 'n8n-nodes-base.httpRequest', 4.2, [3520, -100], {
        'method': 'PATCH',
        'url': "={{ $('Validate payload').first().json.settings.bubble_api_base }}/notificationlog/{{ $('Validate payload').first().json.request_id }}",
        'authentication': 'genericCredentialType',
        'genericAuthType': 'httpHeaderAuth',
        'sendBody': True,
        'specifyBody': 'json',
        'jsonBody': (
            '={{ JSON.stringify({ status: $json.response.status, email_subject: $json.response.subject || "", '
            'email_body: $json.response.body || "", error_message: $json.response.error_message || "", '
            'completed_at: $json.response.completed_at }) }}'
        ),
        'options': {'timeout': 15000},
    }, credentials=BUBBLE_CRED, onError='continueRegularOutput'),
]

C = {}
def link(a, b, out=0):
    C.setdefault(a, {'main': []})
    while len(C[a]['main']) <= out:
        C[a]['main'].append([])
    C[a]['main'][out].append({'node': b, 'type': 'main', 'index': 0})

link('Webhook from Bubble', 'Settings (edit me)')
link('Settings (edit me)', 'Validate payload')
link('Validate payload', 'Payload valid?')
link('Payload valid?', 'De-duplicate', 0)
link('Payload valid?', 'Build failure response', 1)
link('De-duplicate', 'Duplicate?')
link('Duplicate?', 'Build failure response', 0)
link('Duplicate?', 'Compute royalty facts', 1)
link('Compute royalty facts', 'Build AI prompt')
link('Build AI prompt', 'Call AI (chat completions)')
link('Call AI (chat completions)', 'Fact-check AI email', 0)
link('Call AI (chat completions)', 'Build failure response', 1)   # error output
link('Fact-check AI email', 'Email passed checks?')
link('Email passed checks?', 'Send real email? (bonus)', 0)
link('Email passed checks?', 'Build failure response', 1)
link('Send real email? (bonus)', 'Send email (SMTP)', 0)
link('Send real email? (bonus)', 'Build success response', 1)
link('Send email (SMTP)', 'Build success response')
link('Build success response', 'Respond: Success')
link('Build failure response', 'Respond: Failed')
link('Respond: Success', 'Bubble callback enabled?')
link('Respond: Failed', 'Bubble callback enabled?')
link('Bubble callback enabled?', 'Update Bubble Notification Log (Data API)', 0)

workflow = {
    'name': 'BookLeaf – AI Royalty Summary',
    'nodes': nodes,
    'connections': C,
    'active': False,
    'settings': {'executionOrder': 'v1', 'saveDataErrorExecution': 'all', 'saveDataSuccessExecution': 'all', 'saveManualExecutions': True},
    'pinData': {},
    'meta': {'templateCredsSetupCompleted': False},
    'tags': [],
}
out = ROOT / 'n8n' / 'bookleaf-royalty-summary.json'
# Optional bonus nodes ship disabled: n8n will not publish a workflow whose nodes lack credentials, and both are
# switched off in Settings anyway. Enable them (and add their credentials) only if you turn the feature on.
for n in nodes:
    if n['name'] in ('Send email (SMTP)', 'Update Bubble Notification Log (Data API)'):
        n['disabled'] = True

out.write_text(json.dumps(workflow, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
print(f'wrote {out.relative_to(ROOT)} ({len(nodes)} nodes)')
