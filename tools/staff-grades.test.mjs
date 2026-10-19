import assert from 'node:assert/strict';
import {mkdtemp, readFile, readdir, rm, stat, unlink, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {createCode, createStaffCode, decryptRecord, decryptStaffRecord, encryptRecord, encryptStaffRecord, recordId, staffRecordId} from '../teaching-site/assets/grades-crypto.mjs';
import {assessments, distribution, summarize} from '../teaching-site/assets/grade-statistics.mjs';
import {initialize, publish} from './publish-grades.mjs';

const date = '2026-10-19T08:00:00Z';
const student = (id, score) => ({student_id: id, name: 'Fictional Student', grades: {
    quiz: [{label: 'Quiz 1', score, max_score: null}], midterm: [], homework: [], final: []
}});
const classData = () => ({students: [student('DEMO001', 0), student('DEMO002', 'NP')], roster: [
    {student_id: 'DEMO001', group: 'Group 1'}, {student_id: 'DEMO002', group: 'Group 2'}
]});

test('master code decrypts the separate class record and preserves NP versus zero', async () => {
    const code = createStaffCode();
    const data = classData();
    const {id, envelope} = await encryptStaffRecord(data, code, date);
    assert.match(code, /^C1T-[A-Za-z0-9_-]{43}$/);
    assert.equal(id, await staffRecordId(code));
    const record = await decryptStaffRecord(envelope, code);
    assert.deepEqual(record.students, data.students);
    assert.deepEqual(record.roster, data.roster);
    assert.ok(!JSON.stringify(record).includes('access_code'));
    assert.ok(!JSON.stringify(envelope).includes(code));
    await assert.rejects(decryptStaffRecord(envelope, createStaffCode()));
});

test('student codes cannot unlock staff data, even with the same raw secret and a changed prefix', async () => {
    const code = createCode();
    const master = code.replace('C1-', 'C1T-');
    const individual = await encryptRecord(student('DEMO001', 0), code, date);
    const staff = await encryptStaffRecord(classData(), master, date);
    assert.notEqual(await recordId(code), await staffRecordId(master));
    await assert.rejects(decryptStaffRecord(staff.envelope, code));
    await assert.rejects(decryptRecord(staff.envelope, code));
    await assert.rejects(decryptStaffRecord(individual.envelope, master));
    const altered = {...staff.envelope, salt: `${staff.envelope.salt[0] === 'A' ? 'B' : 'A'}${staff.envelope.salt.slice(1)}`};
    await assert.rejects(decryptStaffRecord(altered, master));
    await assert.rejects(encryptStaffRecord({...classData(), roster: []}, master, date));
});

test('means and histograms include zero and exclude NP, letters, and unrecorded results', () => {
    const students = [0, 'NP', 10, 'P', null].map((value, i) => student(`DEMO${i}`, value));
    const [assessment] = assessments(students);
    const summary = summarize(students, assessment);
    assert.equal(summary.numericCount, 2);
    assert.equal(summary.mean, 5);
    assert.equal(summary.median, 5);
    assert.equal(summary.np, 1);
    assert.equal(summary.unrecorded, 1);
    assert.equal(summary.recorded, 3);
    const histogram = distribution(students, assessment);
    assert.equal(histogram[0].count, 1);
    assert.equal(histogram.at(-1).count, 1);
    assert.equal(histogram.reduce((sum, bin) => sum + bin.count, 0), 2);
    assert.equal(summarize([student('X', 'NP')], assessment).mean, null);
    assert.deepEqual(distribution([student('X', 'NP')], assessment), []);
    assert.deepEqual(assessments([student('X', null)]), []);
});

test('publisher keeps master and student codes stable, omits the demo, and rotates master independently', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'gbu-staff-test-'));
    const privateDir = path.join(directory, 'private');
    const outputDir = path.join(directory, 'public');
    try {
        await initialize(privateDir);
        const students = [...classData().students, student('DEMO_TEST_001', 9)];
        await writeFile(path.join(privateDir, 'gradebook.json'), JSON.stringify({students}));
        await writeFile(path.join(privateDir, 'import-roster.json'), JSON.stringify(classData().roster));
        await publish({privateDir, outputDir});
        const readJSON = async file => JSON.parse(await readFile(path.join(privateDir, file), 'utf8'));
        const master = (await readJSON('staff-access.json')).master_code;
        const codes = await readJSON('access-codes.json');
        const staffFile = path.join(`${outputDir}-staff`, `${await staffRecordId(master)}.json`);
        const record = await decryptStaffRecord(JSON.parse(await readFile(staffFile, 'utf8')), master);
        assert.equal(record.students.length, 2);
        assert.ok(!record.students.some(s => s.student_id === 'DEMO_TEST_001'));
        for (const entry of codes.students) assert.ok(!JSON.stringify(record).includes(entry.access_code));
        await publish({privateDir, outputDir});
        assert.equal((await readJSON('staff-access.json')).master_code, master);
        assert.deepEqual(await readJSON('access-codes.json'), codes);
        await publish({privateDir, outputDir, rotateStaff: true});
        assert.notEqual((await readJSON('staff-access.json')).master_code, master);
        assert.deepEqual(await readJSON('access-codes.json'), codes);
        await assert.rejects(readFile(staffFile));
        assert.equal((await readdir(`${outputDir}-staff`)).length, 1);
        assert.equal((await stat(path.join(privateDir, 'teacher-master-code.txt'))).mode & 0o777, 0o600);
        await unlink(path.join(privateDir, 'staff-access.json'));
        await assert.rejects(publish({privateDir, outputDir}), /backup/);
    } finally { await rm(directory, {recursive: true, force: true}); }
});
