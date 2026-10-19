import {chmod, lstat, mkdir, readFile, readdir, realpath, rename, unlink, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createCode, encryptRecord, parseCode, validateGradebook} from '../teaching-site/assets/grades-crypto.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_PRIVATE = path.resolve(repo, '..', 'private-grades', 'calculus-1');
export const DEFAULT_OUTPUT = path.join(repo, 'teaching-site', 'grades-data', 'calculus-1');

async function exists(file) {
    try { await lstat(file); return true; } catch (error) {
        if (error.code === 'ENOENT') return false;
        throw error;
    }
}

async function atomicWrite(file, text, mode) {
    const temporary = `${file}.tmp`;
    await writeFile(temporary, text, {mode, flag: 'wx'});
    await rename(temporary, file);
    await chmod(file, mode);
}

async function privateDirectory(directory) {
    // Reject private inputs anywhere inside the public repository, even if ignored.
    const relative = path.relative(repo, path.resolve(directory));
    if (!relative.startsWith(`..${path.sep}`) && relative !== '..') {
        throw new Error('Private grade files must stay outside the website repository.');
    }
    await mkdir(directory, {recursive: true, mode: 0o700});
    if ((await lstat(directory)).isSymbolicLink()) throw new Error('Private directory cannot be a symlink.');
    const resolved = path.relative(await realpath(repo), await realpath(directory));
    if (!resolved.startsWith(`..${path.sep}`) && resolved !== '..') {
        throw new Error('Private grade files cannot resolve inside the website repository.');
    }
    await chmod(directory, 0o700);
}

async function readPrivate(file) {
    if ((await lstat(file)).isSymbolicLink()) throw new Error('Private files cannot be symlinks.');
    await chmod(file, 0o600);
    try { return JSON.parse(await readFile(file, 'utf8')); } catch {
        throw new Error('A private JSON file is invalid; check its syntax locally.');
    }
}

export async function initialize(directory = DEFAULT_PRIVATE) {
    await privateDirectory(directory);
    const file = path.join(directory, 'gradebook.json');
    if (await exists(file)) throw new Error('A gradebook already exists; it was not overwritten.');
    await atomicWrite(file, `${JSON.stringify({students: []}, null, 2)}\n`, 0o600);
}

export async function publish({privateDir = DEFAULT_PRIVATE, outputDir = DEFAULT_OUTPUT, rotate} = {}) {
    await privateDirectory(privateDir);
    const book = await readPrivate(path.join(privateDir, 'gradebook.json'));
    validateGradebook(book);
    if (rotate && !book.students.some(student => student.student_id === rotate)) {
        throw new Error('Rotation student ID is not in the gradebook.');
    }
    const oldFiles = await exists(outputDir) ? (await readdir(outputDir)).filter(f => /^[a-f0-9]{64}\.json$/.test(f)) : [];
    const codesFile = path.join(privateDir, 'access-codes.json');
    if (!(await exists(codesFile)) && oldFiles.length) {
        throw new Error('Access-code file missing. Restore its private backup before publishing.');
    }
    const saved = await exists(codesFile) ? await readPrivate(codesFile) : {version: 1, students: []};
    if (saved.version !== 1 || !Array.isArray(saved.students)) throw new Error('Invalid access-code file.');
    const codes = new Map();
    const secrets = new Set();
    for (const entry of saved.students) {
        parseCode(entry.access_code);
        if (codes.has(entry.student_id) || secrets.has(entry.access_code)) throw new Error('Duplicate private access codes or IDs.');
        codes.set(entry.student_id, entry.access_code);
        secrets.add(entry.access_code);
    }
    const updatedAt = new Date().toISOString();
    const records = [];
    const distribution = [];
    const currentCodes = new Set();
    for (const student of book.students) {
        const access_code = student.student_id !== rotate && codes.get(student.student_id) || createCode();
        if (currentCodes.has(access_code)) throw new Error('Duplicate generated access code; retry the export.');
        currentCodes.add(access_code);
        records.push(await encryptRecord(student, access_code, updatedAt));
        distribution.push({student_id: student.student_id, access_code});
    }
    // Validate and encrypt the complete gradebook before changing published output.
    await mkdir(outputDir, {recursive: true});
    await atomicWrite(codesFile, `${JSON.stringify({version: 1, students: distribution}, null, 2)}\n`, 0o600);
    await atomicWrite(path.join(privateDir, 'access-codes.csv'),
        `student_id,access_code\n${distribution.map(s => `${s.student_id},${s.access_code}\n`).join('')}`, 0o600);
    for (const {id, envelope} of records) {
        await atomicWrite(path.join(outputDir, `${id}.json`), `${JSON.stringify(envelope)}\n`, 0o644);
    }
    const current = new Set(records.map(record => `${record.id}.json`));
    for (const file of oldFiles) {
        if (!current.has(file)) await unlink(path.join(outputDir, file));
    }
    return records.length;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const [command, flag, student] = process.argv.slice(2);
    try {
        if (command === 'init' && !flag) {
            await initialize();
            console.log('Created the private gradebook outside the website repository. See tools/GRADES.md for the format.');
        } else if (command === 'publish' && (!flag || (flag === '--rotate' && student))) {
            const count = await publish({rotate: student});
            console.log(`Prepared ${count} encrypted records. Private access codes are in ../private-grades/calculus-1/access-codes.csv.`);
            console.log('Review the website changes, then commit and push to publish updates.');
        } else {
            throw new Error('Usage: node tools/publish-grades.mjs init | publish [--rotate STUDENT_ID]');
        }
    } catch (error) {
        // Do not print student input, grades, codes, or JSON parser excerpts.
        console.error(error.code ? 'Grade export failed. Check local file permissions and paths.' : error.message);
        process.exitCode = 1;
    }
}
