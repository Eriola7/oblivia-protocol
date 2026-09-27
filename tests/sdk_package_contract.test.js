const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const ts = require('typescript');

const root = path.join(__dirname, '..');
const sdkPackage = require('../sdk/package.json');
const sdkLock = require('../sdk/package-lock.json');

// Use the real package self-reference and export map without installing a fake
// consumer, writing temporary source, or importing wallet/submission code.
function compileFixture(fixture, options) {
    const virtualFile = path.join(root, 'sdk', '__package_contract_check__.ts');
    const source = fs.readFileSync(path.join(__dirname, 'fixtures', fixture), 'utf8')
        .replace("from '../../sdk'", "from '@oblivia/sdk'");
    const settings = { noEmit: true, strict: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, ...options };
    const host = ts.createCompilerHost(settings);
    const readSource = host.getSourceFile.bind(host);
    host.getSourceFile = (file, language, onError, fresh) => file === virtualFile
        ? ts.createSourceFile(file, source, language, true)
        : readSource(file, language, onError, fresh);
    const program = ts.createProgram([virtualFile], settings, host);
    const errors = ts.getPreEmitDiagnostics(program).map(diagnostic =>
        `TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`);
    assert.deepEqual(errors, []);
}

test('both SDK entry points resolve distinct TypeScript APIs through package exports', () => {
    for (const settings of [
        { module: ts.ModuleKind.Node16, moduleResolution: ts.ModuleResolutionKind.Node16 },
        { module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler },
    ]) {
        compileFixture('sdk-api-types.ts', settings);
        compileFixture('sdk-browser-types.ts', settings);
    }
    const sdkRequire = createRequire(path.join(root, 'sdk/index.js'));
    assert.equal(sdkRequire.resolve('@oblivia/sdk'), path.join(root, 'sdk/index.js'));
    assert.equal(sdkRequire.resolve('@oblivia/sdk/browser'), path.join(root, 'sdk/browser.js'));
});

test('SDK Node requirement agrees across package, lockfile and requirements documentation', () => {
    assert.equal(sdkPackage.engines.node, '>=22.14.0');
    assert.deepEqual(sdkLock.packages[''].engines, sdkPackage.engines);
    assert.match(fs.readFileSync(path.join(root, 'sdk/README.md'), 'utf8'), /Node\.js 22\.14\.0\+/);
});
