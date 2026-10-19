import assert from 'node:assert/strict';
import {mkdtemp, readFile, readdir, rm, stat, symlink, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {createCode, decryptRecord, encryptRecord, parseCode, recordId, validateGradebook} from '../teaching-site/assets/grades-crypto.mjs';
import {initialize, publish} from './publish-grades.mjs';

const updated = '2026-10-19T08:00:00.000Z';
function student(id = 'DEMO001') {
    return {student_id: id, name: 'Fictional Student', grades: {
        quiz: [{label: 'Quiz 1', score: 8, max_score: 10}],
        midterm: [{label: 'Midterm', score: null, max_score: 100}], homework: [], final: []
    }};
}

test('round trip preserves scores, pending results, and Unicode', async () => {
    const source = student();
    source.name = '测试同学';
    source.grades.quiz[0].comment = '<img src=x onerror=alert(1)>';
    const code = createCode();
    const {envelope, id} = await encryptRecord(source, code, updated);
    assert.match(code, /^C1-[A-Za-z0-9_-]{43}$/);
    assert.match(id, /^[a-f0-9]{64}$/);
    const record = await decryptRecord(envelope, `  ${code}  `);
    assert.deepEqual(record.student, source);
    assert.equal(record.updated_at, updated);
    assert.equal(await recordId(code), id);
    assert.ok(!JSON.stringify(envelope).includes(source.name));
    assert.ok(!JSON.stringify(envelope).includes(source.student_id));
    assert.ok(!JSON.stringify(envelope).includes(code));
});

test('another student code cannot decrypt a record', async () => {
    const {envelope} = await encryptRecord(student(), createCode(), updated);
    await assert.rejects(decryptRecord(envelope, createCode()));
});

test('tampering with ciphertext, IV, salt, or version fails closed', async () => {
    const code = createCode();
    const {envelope} = await encryptRecord(student(), code, updated);
    for (const field of ['salt', 'iv', 'ciphertext']) {
        const value = envelope[field];
        const altered = `${value[0] === 'A' ? 'B' : 'A'}${value.slice(1)}`;
        await assert.rejects(decryptRecord({...envelope, [field]: altered}, code));
    }
    await assert.rejects(decryptRecord({...envelope, version: 2}, code));
    await assert.rejects(decryptRecord({...envelope, ciphertext: envelope.ciphertext.slice(1)}, code));
});

test('fresh nonces change ciphertext and padding hides different record lengths', async () => {
    const code = createCode();
    const a = (await encryptRecord(student(), code, updated)).envelope;
    const b = (await encryptRecord(student(), code, updated)).envelope;
    const longer = student();
    longer.grades.homework.push({label: 'Homework 1', score: 93, max_score: 100});
    const c = (await encryptRecord(longer, createCode(), updated)).envelope;
    assert.notEqual(a.iv, b.iv);
    assert.notEqual(a.salt, b.salt);
    assert.notEqual(a.ciphertext, b.ciphertext);
    assert.equal(JSON.stringify(a).length, JSON.stringify(c).length);
});

test('short passwords, invalid scores, duplicate IDs, and oversized records are refused', async () => {
    for (const code of ['123456', 'student123', 'C1-../../etc/passwd', `C1-${'A'.repeat(42)}B`]) {
        assert.throws(() => parseCode(code));
    }
    assert.throws(() => validateGradebook({students: [student(), student()]}));
    const invalid = student();
    invalid.grades.quiz[0].score = '8';
    assert.throws(() => validateGradebook({students: [invalid]}));
    const huge = student();
    huge.grades.homework = Array.from({length: 100}, () => ({label: 'Long comment', score: 1, max_score: 1, comment: 'a'.repeat(500)}));
    await assert.rejects(encryptRecord(huge, createCode(), updated));
});

test('publishing supports updates, per-student isolation, rotation, and removal', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'gbu-grades-test-'));
    const privateDir = path.join(directory, 'private');
    const outputDir = path.join(directory, 'public');
    try {
        await initialize(privateDir);
        const a = student('DEMO001');
        const b = student('DEMO002');
        const file = path.join(privateDir, 'gradebook.json');
        await writeFile(file, JSON.stringify({students: [a, b]}));
        assert.equal(await publish({privateDir, outputDir}), 2);
        const codesFile = path.join(privateDir, 'access-codes.json');
        const saved = JSON.parse(await readFile(codesFile, 'utf8'));
        const [first, second] = saved.students.map(s => s.access_code);
        const readEnvelope = async code => JSON.parse(await readFile(path.join(outputDir, `${await recordId(code)}.json`), 'utf8'));
        assert.equal((await decryptRecord(await readEnvelope(first), first)).student.student_id, a.student_id);
        await assert.rejects(decryptRecord(await readEnvelope(second), first));
        a.grades.quiz[0].score = 10;
        await writeFile(file, JSON.stringify({students: [a, b]}));
        await publish({privateDir, outputDir});
        assert.deepEqual(JSON.parse(await readFile(codesFile, 'utf8')), saved);
        assert.equal((await decryptRecord(await readEnvelope(first), first)).student.grades.quiz[0].score, 10);
        await publish({privateDir, outputDir, rotate: a.student_id});
        const rotated = JSON.parse(await readFile(codesFile, 'utf8')).students;
        assert.notEqual(rotated[0].access_code, first);
        assert.equal(rotated[1].access_code, second);
        await assert.rejects(readEnvelope(first));
        await writeFile(file, JSON.stringify({students: [b]}));
        await publish({privateDir, outputDir});
        assert.deepEqual(await readdir(outputDir), [`${await recordId(second)}.json`]);
        assert.equal((await stat(codesFile)).mode & 0o777, 0o600);
        assert.equal((await stat(privateDir)).mode & 0o777, 0o700);
        const publicText = await readFile(path.join(outputDir, `${await recordId(second)}.json`), 'utf8');
        for (const secret of [b.student_id, b.name, first, second, 'Quiz 1']) assert.ok(!publicText.includes(secret));
        await rm(codesFile);
        await assert.rejects(publish({privateDir, outputDir}), /backup/);
        assert.equal((await readdir(outputDir)).length, 1);
    } finally {
        await rm(directory, {recursive: true, force: true});
    }
});

test('invalid gradebooks leave already published records and codes unchanged', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'gbu-grades-test-'));
    const privateDir = path.join(directory, 'private');
    const outputDir = path.join(directory, 'public');
    try {
        await initialize(privateDir);
        const file = path.join(privateDir, 'gradebook.json');
        await writeFile(file, JSON.stringify({students: [student()]}));
        await publish({privateDir, outputDir});
        const names = await readdir(outputDir);
        const original = await readFile(path.join(outputDir, names[0]), 'utf8');
        const codes = await readFile(path.join(privateDir, 'access-codes.json'), 'utf8');
        await writeFile(file, JSON.stringify({students: [student(), student()]}));
        await assert.rejects(publish({privateDir, outputDir}));
        assert.equal(await readFile(path.join(outputDir, names[0]), 'utf8'), original);
        assert.equal(await readFile(path.join(privateDir, 'access-codes.json'), 'utf8'), codes);
    } finally {
        await rm(directory, {recursive: true, force: true});
    }
});

test('private files cannot be placed in the public repo, including through a parent symlink', async () => {
    const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    await assert.rejects(initialize(path.join(repo, 'private-grades')), /outside/);
    const directory = await mkdtemp(path.join(os.tmpdir(), 'gbu-grades-test-'));
    try {
        const alias = path.join(directory, 'repo-alias');
        await symlink(repo, alias, 'dir');
        await assert.rejects(initialize(path.join(alias, 'tools')), /resolve inside/);
    } finally {
        await rm(directory, {recursive: true, force: true});
    }
});
