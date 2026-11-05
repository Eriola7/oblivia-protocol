// Keeps the hand-written parts of the docs site honest about the code.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('the relay API page documents exactly the routes the relay serves', () => {
    const server = read('relay/server.js');
    const routes = [...server.matchAll(/app\.(get|post)\('([^']+)'/g)]
        .map(([, method, route]) => `${method.toUpperCase()} ${route}`)
        .filter(route => route !== 'GET /');
    routes.push('GET /proving-assets/…');
    const documented = [...read('docs/reference/relay-api.md').matchAll(/^## `(GET|POST) ([^`?]+)/gm)]
        .map(([, method, route]) => `${method} ${route}`);
    assert.deepEqual(documented.sort(), routes.sort());
});

test('documented relay request fields match what the handlers read', () => {
    const server = read('relay/server.js');
    const docs = read('docs/reference/relay-api.md');
    for (const route of ['/sign', '/multisig/create', '/multisig/sign']) {
        const handler = server.slice(server.indexOf(`app.post('${route}'`));
        const fields = handler.match(/const \{ ([^}]+) \} = validateRequestBody/)[1].split(',').map(f => f.trim());
        const section = docs.slice(docs.indexOf(`## \`POST ${route}\``)).split('\n## ')[0];
        const body = JSON.parse(section.match(/```json\n([\s\S]*?)\n```/)[1].replace(/\[\/\*[^*]*\*\/\]/g, '[]').replace(/"hex…"/g, '""'));
        assert.deepEqual(Object.keys(body).sort(), fields.sort(), route);
    }
});

test('docs examples use the current SDK signatures', () => {
    const multisig = read('tools/docs/examples/multisig-devnet.js');
    assert.match(multisig, /signMultiSig\(secrets\[0\], agreement, 2, 3\)/);
    assert.match(multisig, /createMultiSigContract\(agreement, 2, 3\)/);
});
